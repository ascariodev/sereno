<?php

use App\Events\LogSourceConnected;
use App\Http\Middleware\AuthenticateLogSource;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    Route::middleware(['api', 'log.source'])
        ->post('/api/log-connected-test', fn (Request $request) => [
            'source' => AuthenticateLogSource::source($request)->id,
        ]);

    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    $this->plainKey = LogSource::newPlainKey();
    $this->source = LogSource::factory()->for($this->project)->withPlainKey($this->plainKey)->create();

    Event::fake([LogSourceConnected::class]);
});

function ingestConnected(string $plainKey)
{
    return test()->withToken($plainKey)->postJson('/api/log-connected-test');
}

it('announces the first use of a key once, with the stored last_used_at and without the key', function () {
    $this->travelTo(now()->startOfSecond()->addMilliseconds(700));

    ingestConnected($this->plainKey)->assertOk();

    $stored = $this->source->fresh()->last_used_at;
    Event::assertDispatchedTimes(LogSourceConnected::class, 1);
    Event::assertDispatched(LogSourceConnected::class, function (LogSourceConnected $event) use ($stored) {
        expect($event->broadcastWith())->toBe([
            'id' => $this->source->id,
            'project_id' => $this->project->id,
            'last_used_at' => $stored->toJSON(),
        ]);

        return true;
    });
});

it('does not announce later uses, inside or past the throttle window', function () {
    $this->freezeSecond();
    ingestConnected($this->plainKey)->assertOk();
    $first = $this->source->fresh()->last_used_at;

    $this->travel(30)->seconds();
    ingestConnected($this->plainKey)->assertOk();
    expect($this->source->fresh()->last_used_at->equalTo($first))->toBeTrue();

    $this->travel(31)->seconds();
    ingestConnected($this->plainKey)->assertOk();
    expect($this->source->fresh()->last_used_at->equalTo(now()))->toBeTrue();

    Event::assertDispatchedTimes(LogSourceConnected::class, 1);
});

it('announces only once when two first requests race', function () {
    $first = LogSource::findByPlainKey($this->plainKey);
    $second = LogSource::findByPlainKey($this->plainKey);

    $first->markAsUsed();
    $this->travel(5)->seconds();
    $second->markAsUsed();

    Event::assertDispatchedTimes(LogSourceConnected::class, 1);
    expect($this->source->fresh()->last_used_at->equalTo($first->last_used_at))->toBeTrue();
});

it('announces again the first use of a rotated key', function () {
    ingestConnected($this->plainKey)->assertOk();

    $newKey = $this->source->fresh()->rotateKey();
    ingestConnected($newKey)->assertOk();

    Event::assertDispatchedTimes(LogSourceConnected::class, 2);
});

it('broadcasts on the project channel after commit as log_source.connected', function () {
    $this->source->last_used_at = now();
    $event = new LogSourceConnected($this->source);

    expect($event)->toBeInstanceOf(ShouldDispatchAfterCommit::class)
        ->and($event->broadcastOn())->toEqual(new PrivateChannel("organizations.{$this->organization->id}.projects.{$this->project->id}"))
        ->and($event->broadcastAs())->toBe('log_source.connected');
});
