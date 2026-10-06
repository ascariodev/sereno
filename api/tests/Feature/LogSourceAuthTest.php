<?php

use App\Http\Middleware\AuthenticateLogSource;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Providers\AppServiceProvider;
use App\Support\CurrentOrganization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    // Throttle listed first on purpose: the priority list must still run log.source before it.
    Route::middleware(['api', 'throttle:log-ingest', 'log.source'])
        ->post('/api/log-ingest-test', fn (Request $request) => [
            'source' => AuthenticateLogSource::source($request)->id,
            'organization' => app(CurrentOrganization::class)->id(),
            'team' => getPermissionsTeamId(),
            'projects' => Project::pluck('id'),
        ]);

    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    Project::factory()->for(Organization::factory())->create();

    $this->plainKey = LogSource::newPlainKey();
    $this->source = LogSource::factory()->for($this->project)->withPlainKey($this->plainKey)->create();
});

function ingest(?string $token, string $locale = 'en')
{
    $request = test()->withHeader('Accept-Language', $locale);

    if ($token !== null) {
        $request = $request->withToken($token);
    }

    return $request->postJson('/api/log-ingest-test');
}

it('authenticates a valid key and activates its organization', function () {
    ingest($this->plainKey)
        ->assertOk()
        ->assertJsonPath('source', $this->source->id)
        ->assertJsonPath('organization', $this->organization->id)
        ->assertJsonPath('team', $this->organization->id)
        ->assertJsonPath('projects', [$this->project->id]);
});

it('rejects invalid credentials with the same translated 401', function (callable $token) {
    ingest($token($this), 'es')
        ->assertUnauthorized()
        ->assertExactJson(['message' => __('Unauthenticated.', [], 'es')]);
})->with([
    'missing' => [fn () => null],
    'malformed' => [fn () => 'wsk_short'],
    'wrong prefix' => [fn () => 'xyz_'.str_repeat('a', 40)],
    'unknown key' => [fn () => LogSource::newPlainKey()],
    'revoked' => [function ($test) {
        $test->source->forceFill(['revoked_at' => now()])->save();

        return $test->plainKey;
    }],
    'archived project' => [function ($test) {
        $test->project->forceFill(['archived_at' => now()])->save();

        return $test->plainKey;
    }],
    'user sanctum token' => [fn () => User::factory()->create()->createToken('test')->plainTextToken],
]);

it('clears the active organization left by a previous request when it fails', function () {
    app(CurrentOrganization::class)->set($this->organization);

    ingest('wsk_short')->assertUnauthorized();

    expect(app(CurrentOrganization::class)->id())->toBeNull()
        ->and(getPermissionsTeamId())->toBeNull();
});

it('throttles per source with a translated 429', function () {
    $other = LogSource::factory()->for($this->project)->withPlainKey($otherKey = LogSource::newPlainKey())->create();

    RateLimiter::increment(
        md5('log-ingest'.'log-source:'.$this->source->id),
        amount: AppServiceProvider::LOG_INGEST_REQUESTS_PER_MINUTE,
    );

    $response = ingest($this->plainKey, 'es')->assertTooManyRequests();

    $response->assertJsonPath('message', __('Too many attempts. Please try again in :seconds seconds.', [
        'seconds' => $response->headers->get('Retry-After'),
    ], 'es'));

    ingest($otherKey)->assertOk()->assertJsonPath('source', $other->id);
});

it('writes last_used_at at most once per minute', function () {
    $this->freezeSecond();
    $first = now();

    ingest($this->plainKey)->assertOk();
    expect($this->source->fresh()->last_used_at->equalTo($first))->toBeTrue();

    $this->travel(30)->seconds();
    ingest($this->plainKey)->assertOk();
    expect($this->source->fresh()->last_used_at->equalTo($first))->toBeTrue();

    $this->travel(31)->seconds();
    ingest($this->plainKey)->assertOk();
    expect($this->source->fresh()->last_used_at->equalTo(now()))->toBeTrue();
});
