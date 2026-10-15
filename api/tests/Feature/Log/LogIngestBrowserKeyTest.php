<?php

use App\Enums\LogSourceKind;
use App\Jobs\IngestLogEvents;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;

beforeEach(function () {
    Queue::fake();

    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    [$this->source, $this->browserKey] = LogSource::issueFor(
        $this->project,
        'spa',
        LogSourceKind::Browser,
        ['https://app.example.com', 'http://localhost:5173'],
    );
});

function ingestFromBrowser(string $plainKey, ?string $origin, string $ip = '203.0.113.10')
{
    $headers = $origin === null ? [] : ['Origin' => $origin];

    return test()->withToken($plainKey)
        ->withHeaders($headers)
        ->withServerVariables(['REMOTE_ADDR' => $ip])
        ->postJson('/api/ingest/events', ['events' => [['level' => 'error', 'message' => 'Boom']]]);
}

it('accepts a browser key from an allowed origin', function (string $origin) {
    ingestFromBrowser($this->browserKey, $origin)
        ->assertStatus(202)
        ->assertExactJson(['accepted' => 1])
        ->assertHeader('Access-Control-Allow-Origin', '*');

    Queue::assertPushed(IngestLogEvents::class, fn (IngestLogEvents $job) => $job->sourceId === $this->source->id);
})->with([
    'production origin' => 'https://app.example.com',
    'local origin' => 'http://localhost:5173',
]);

it('rejects a browser key from an origin that is not listed', function (string $origin) {
    ingestFromBrowser($this->browserKey, $origin)
        ->assertUnauthorized()
        ->assertExactJson(['message' => __('Unauthenticated.')]);

    Queue::assertNothingPushed();
})->with([
    'other host' => 'https://evil.example.com',
    'other scheme' => 'http://app.example.com',
    'other port' => 'https://app.example.com:8443',
    'with trailing slash' => 'https://app.example.com/',
    'different case' => 'https://APP.example.com',
    'opaque origin' => 'null',
]);

it('rejects a browser key without an Origin header', function () {
    ingestFromBrowser($this->browserKey, null)->assertUnauthorized();

    Queue::assertNothingPushed();
});

it('rejects keys whose prefix does not match the kind of the source', function () {
    $browserKeyOnServer = LogSource::newPlainKey(LogSourceKind::Browser);
    LogSource::factory()->for($this->project)->withPlainKey($browserKeyOnServer)->create();

    $serverKeyOnBrowser = LogSource::newPlainKey();
    LogSource::factory()->for($this->project)->browser(['https://app.example.com'])->withPlainKey($serverKeyOnBrowser)->create();

    ingestFromBrowser($browserKeyOnServer, 'https://app.example.com')->assertUnauthorized();
    ingestFromBrowser($serverKeyOnBrowser, 'https://app.example.com')->assertUnauthorized();

    Queue::assertNothingPushed();
});

it('rejects revoked browser keys from an allowed origin', function () {
    $this->source->forceFill(['revoked_at' => now()])->save();

    ingestFromBrowser($this->browserKey, 'https://app.example.com')->assertUnauthorized();
});

it('counts a disallowed origin as an authentication failure of the IP', function () {
    RateLimiter::increment(
        'log-ingest-auth-failures:203.0.113.10',
        amount: config('workspace.log.auth_failures.max_attempts') - 1,
    );

    ingestFromBrowser($this->browserKey, 'https://evil.example.com')->assertUnauthorized();
    ingestFromBrowser($this->browserKey, 'https://app.example.com')->assertTooManyRequests();
});

it('limits browser keys per IP and source with 429', function () {
    for ($i = 0; $i < AppServiceProvider::LOG_INGEST_BROWSER_REQUESTS_PER_IP_PER_MINUTE; $i++) {
        ingestFromBrowser($this->browserKey, 'https://app.example.com')->assertStatus(202);
    }

    ingestFromBrowser($this->browserKey, 'https://app.example.com')
        ->assertTooManyRequests()
        ->assertHeader('Retry-After');

    ingestFromBrowser($this->browserKey, 'https://app.example.com', '203.0.113.20')->assertStatus(202);
});

it('does not limit server keys per IP', function () {
    $serverKey = LogSource::newPlainKey();
    LogSource::factory()->for($this->project)->withPlainKey($serverKey)->create();

    for ($i = 0; $i <= AppServiceProvider::LOG_INGEST_BROWSER_REQUESTS_PER_IP_PER_MINUTE; $i++) {
        ingestFromBrowser($serverKey, null)->assertStatus(202);
    }
});

it('accepts server keys with any Origin', function () {
    $serverKey = LogSource::newPlainKey();
    LogSource::factory()->for($this->project)->withPlainKey($serverKey)->create();

    ingestFromBrowser($serverKey, 'https://anything.example.com')->assertStatus(202);
});

it('answers the preflight of the ingestion endpoint before authenticating', function () {
    $response = $this->call('OPTIONS', '/api/ingest/events', server: [
        'HTTP_ORIGIN' => 'https://app.example.com',
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,content-type',
    ]);

    expect($response->getStatusCode())->toBe(204)
        ->and($response->headers->get('Access-Control-Allow-Origin'))->toBe('*')
        ->and(strtolower($response->headers->get('Access-Control-Allow-Headers')))->toContain('authorization');
});
