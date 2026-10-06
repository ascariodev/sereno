<?php

use App\Jobs\IngestLogEvents;
use App\Models\LogGroup;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Providers\AppServiceProvider;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    $this->plainKey = LogSource::newPlainKey();
    $this->source = LogSource::factory()->for($this->project)->withPlainKey($this->plainKey)->create();
});

function postIngest(mixed $body, ?string $locale = null)
{
    $request = test()->withToken(test()->plainKey);

    if ($locale !== null) {
        $request = $request->withHeader('Accept-Language', $locale);
    }

    return $request->postJson('/api/ingest/events', $body);
}

function validEvent(array $overrides = []): array
{
    return array_merge(['level' => 'error', 'message' => 'Boom'], $overrides);
}

it('requires a valid source key', function () {
    $this->postJson('/api/ingest/events', ['events' => [validEvent()]])->assertUnauthorized();
});

it('queues the validated events with the source id and answers 202', function () {
    Queue::fake();

    postIngest(['events' => [
        validEvent(['context' => ['user' => 7], 'occurred_at' => '2026-01-02T03:04:05Z', 'fingerprint' => 'fp']),
        validEvent(['level' => 'info', 'message' => 'Second']),
    ]])->assertStatus(202)->assertExactJson(['accepted' => 2]);

    Queue::assertPushed(IngestLogEvents::class, function (IngestLogEvents $job) {
        return $job->sourceId === $this->source->id
            && count($job->events) === 2
            && $job->events[0]['context'] === ['user' => 7]
            && $job->events[0]['fingerprint'] === 'fp'
            && $job->events[0]['occurred_at'] === '2026-01-02T03:04:05+00:00'
            && $job->events[1]['occurred_at'] === null;
    });
});

it('encrypts the job payload', function () {
    expect(new IngestLogEvents(1, []))->toBeInstanceOf(ShouldBeEncrypted::class);
});

it('clamps an occurred_at too far in the future to the reception time', function () {
    Queue::fake();
    $this->travelTo('2026-05-01 10:00:00');

    postIngest(['events' => [validEvent(['occurred_at' => '2030-01-01T00:00:00Z'])]])->assertStatus(202);

    Queue::assertPushed(IngestLogEvents::class, fn (IngestLogEvents $job) => $job->events[0]['occurred_at'] === '2026-05-01T10:00:00+00:00');
});

it('records and groups the events with the sync queue', function () {
    postIngest(['events' => [
        validEvent(['message' => 'Order 123 failed']),
        validEvent(['message' => 'Order 456 failed', 'level' => 'critical']),
    ]])->assertStatus(202);

    $group = LogGroup::withoutGlobalScopes()->sole();

    expect($group->events_count)->toBe(2)
        ->and($group->level->value)->toBe('critical')
        ->and($group->organization_id)->toBe($this->organization->id)
        ->and(DB::table('log_events')->count())->toBe(2);
});

it('still records a batch accepted from a source revoked afterwards', function () {
    $job = new IngestLogEvents($this->source->id, [validEvent()]);
    $this->source->forceFill(['revoked_at' => now()])->save();

    app()->call([$job, 'handle']);

    expect(DB::table('log_events')->count())->toBe(1);
});

it('drops a batch whose source no longer exists', function () {
    $job = new IngestLogEvents($this->source->id, [validEvent()]);
    DB::table('log_sources')->where('id', $this->source->id)->delete();

    app()->call([$job, 'handle']);

    expect(DB::table('log_events')->count())->toBe(0);
});

it('rejects invalid bodies with 422 and never 500', function (mixed $body) {
    Queue::fake();

    postIngest($body)->assertUnprocessable();
    Queue::assertNothingPushed();
})->with([
    'no body' => [[]],
    'empty events' => [['events' => []]],
    'events is a string' => [['events' => 'x']],
    'event is a string' => [['events' => ['x']]],
    'unknown level' => [['events' => [['level' => 'loud', 'message' => 'm']]]],
    'level array' => [['events' => [['level' => ['error'], 'message' => 'm']]]],
    'missing message' => [['events' => [['level' => 'error']]]],
    'message array' => [['events' => [['level' => 'error', 'message' => ['a']]]]],
    'message number' => [['events' => [['level' => 'error', 'message' => 5]]]],
    'message too long' => [['events' => [['level' => 'error', 'message' => str_repeat('a', 8193)]]]],
    'context string' => [['events' => [['level' => 'error', 'message' => 'm', 'context' => 'text']]]],
    'context too big' => [['events' => [['level' => 'error', 'message' => 'm', 'context' => ['a' => str_repeat('x', 33000)]]]]],
    'context too deep' => [['events' => [['level' => 'error', 'message' => 'm', 'context' => [[[[[[[[[['x']]]]]]]]]]]]]],
    'occurred_at array' => [['events' => [['level' => 'error', 'message' => 'm', 'occurred_at' => ['x']]]]],
    'occurred_at garbage' => [['events' => [['level' => 'error', 'message' => 'm', 'occurred_at' => 'not a date']]]],
    'fingerprint array' => [['events' => [['level' => 'error', 'message' => 'm', 'fingerprint' => ['x']]]]],
    'fingerprint too long' => [['events' => [['level' => 'error', 'message' => 'm', 'fingerprint' => str_repeat('a', 256)]]]],
    'null char in message' => [['events' => [['level' => 'error', 'message' => "a\0b"]]]],
    'null char in fingerprint' => [['events' => [['level' => 'error', 'message' => 'm', 'fingerprint' => "a\0b"]]]],
    'null char in nested context' => [['events' => [['level' => 'error', 'message' => 'm', 'context' => ['a' => ['b' => "x\0y"]]]]]],
    'null char in context key' => [['events' => [['level' => 'error', 'message' => 'm', 'context' => ["k\0" => 'v']]]]],
    '101 events' => [['events' => array_fill(0, 101, ['level' => 'error', 'message' => 'm'])]],
]);

it('rejects a very deep context without a server error', function () {
    $deep = 'x';
    for ($i = 0; $i < 400; $i++) {
        $deep = [$deep];
    }

    postIngest(['events' => [validEvent(['context' => $deep])]])->assertUnprocessable();
});

it('accepts 100 events, a 32 KB context and an 8192 character message', function () {
    Queue::fake();

    $events = array_fill(0, 99, validEvent());
    $events[] = validEvent(['message' => str_repeat('a', 8192), 'context' => ['d' => str_repeat('x', 32000)]]);

    postIngest(['events' => $events])->assertStatus(202)->assertJson(['accepted' => 100]);
});

it('rejects an oversized body with a translated 413', function () {
    Queue::fake();

    postIngest(['events' => [validEvent(['message' => str_repeat('a', 6 * 1024 * 1024)])]], 'es')
        ->assertStatus(413)
        ->assertJsonPath('message', 'El cuerpo de la petición es demasiado grande.');
});

it('translates validation errors', function () {
    postIngest(['events' => [validEvent(['context' => 'x'])]], 'es')
        ->assertUnprocessable()
        ->assertJsonValidationErrors('events.0.context');
});

it('throttles per source with 429', function () {
    RateLimiter::increment(
        md5('log-ingest'.'log-source:'.$this->source->id),
        amount: AppServiceProvider::LOG_INGEST_REQUESTS_PER_MINUTE,
    );

    postIngest(['events' => [validEvent()]])->assertTooManyRequests();
});

it('tries the job only once', function () {
    expect((new IngestLogEvents(1, []))->tries)->toBe(1);
});

it('translates the null character error', function () {
    postIngest(['events' => [['level' => 'error', 'message' => "a\0b"]]], 'es')
        ->assertUnprocessable()
        ->assertJsonPath('errors', fn ($e) => $e['events.0.message'][0] === 'El campo events.0.message no puede contener caracteres nulos.');
});
