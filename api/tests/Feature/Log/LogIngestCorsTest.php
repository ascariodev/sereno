<?php

use App\Enums\LogSourceKind;
use App\Http\Requests\LogIngest\IngestEventsRequest;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;

const CORS_INGEST_ORIGIN = 'https://app.example.com';

beforeEach(function () {
    Queue::fake();

    $project = Project::factory()->for(Organization::factory())->create();
    [$this->source, $this->browserKey] = LogSource::issueFor($project, 'spa', LogSourceKind::Browser, [CORS_INGEST_ORIGIN]);
});

function corsIngest(?string $plainKey, string $origin = CORS_INGEST_ORIGIN, array $server = [], string $body = '{"events":[{"level":"error","message":"Boom"}]}')
{
    $headers = ['Origin' => $origin, 'Content-Type' => 'application/json', 'Accept' => 'application/json'];

    if ($plainKey !== null) {
        $headers['Authorization'] = "Bearer {$plainKey}";
    }

    return test()->call('POST', '/api/ingest/events', server: test()->transformHeadersToServerVars($headers) + $server, content: $body);
}

function assertIngestCors($response, int $status): void
{
    $response->assertStatus($status);

    expect($response->headers->get('Access-Control-Allow-Origin'))->toBe('*');
}

it('sends CORS headers on accepted browser requests', function () {
    assertIngestCors(corsIngest($this->browserKey), 202);
});

it('sends CORS headers on 401', function (Closure $key, string $origin) {
    assertIngestCors(corsIngest($key(), $origin), 401);
})->with([
    'origin not allowed' => [fn () => test()->browserKey, 'https://evil.example.com'],
    'missing key' => [fn () => null, CORS_INGEST_ORIGIN],
    'unknown key' => [fn () => LogSource::newPlainKey(LogSourceKind::Browser), CORS_INGEST_ORIGIN],
]);

it('sends CORS headers on 413 from a declared Content-Length', function () {
    $response = corsIngest($this->browserKey, server: ['HTTP_CONTENT_LENGTH' => (string) (IngestEventsRequest::MAX_BODY_BYTES + 1)]);

    assertIngestCors($response, 413);
});

it('sends CORS headers on 413 from the actual body', function () {
    $body = '{"events":[{"level":"error","message":"'.str_repeat('a', IngestEventsRequest::MAX_BODY_BYTES).'"}]}';

    assertIngestCors(corsIngest($this->browserKey, body: $body), 413);
});

it('sends CORS headers on 429 after too many authentication failures', function () {
    RateLimiter::increment('log-ingest-auth-failures:127.0.0.1', amount: config('workspace.log.auth_failures.max_attempts'));

    assertIngestCors(corsIngest($this->browserKey), 429);
});

it('sends CORS headers on 429 from the per-source limit', function () {
    RateLimiter::increment(md5('log-ingest'.'log-source:'.$this->source->id), amount: AppServiceProvider::LOG_INGEST_REQUESTS_PER_MINUTE);

    assertIngestCors(corsIngest($this->browserKey), 429);
});

it('sends CORS headers on 429 from the browser per-IP limit', function () {
    RateLimiter::increment(
        md5('log-ingest'.'log-source-ip:'.$this->source->id.'|127.0.0.1'),
        amount: AppServiceProvider::LOG_INGEST_BROWSER_REQUESTS_PER_IP_PER_MINUTE,
    );

    assertIngestCors(corsIngest($this->browserKey), 429);
});
