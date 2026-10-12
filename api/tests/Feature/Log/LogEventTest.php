<?php

use App\Enums\LogLevel;
use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Support\CurrentOrganization;
use App\Support\LogPartitions;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->group = LogGroup::factory()->for($this->project)->create();
});

function makeLogEvent(LogGroup $group, ?LogSource $source = null, array $attributes = []): LogEvent
{
    $event = new LogEvent(array_merge([
        'level' => LogLevel::Error,
        'message' => 'Something failed',
        'context' => ['order' => 42],
        'occurred_at' => now(),
    ], $attributes));
    $event->organization_id = $group->organization_id;
    $event->project_id = $group->project_id;
    $event->log_group_id = $group->id;
    $event->log_source_id = $source?->id;
    $event->save();

    return $event;
}

function logEventPartitions(): array
{
    return DB::table('pg_inherits')
        ->join('pg_class as child', 'child.oid', '=', 'pg_inherits.inhrelid')
        ->join('pg_class as parent', 'parent.oid', '=', 'pg_inherits.inhparent')
        ->where('parent.relname', 'log_events')
        ->pluck('child.relname')
        ->all();
}

it('creates partitions for today and the next seven days on migrate', function () {
    $partitions = logEventPartitions();

    expect($partitions)->not->toBeEmpty();

    foreach (range(0, 7) as $offset) {
        expect($partitions)->toContain(LogPartitions::nameFor(now()->addDays($offset)));
    }
});

it('stores events of two days in their own partitions', function () {
    $first = now()->utc()->addDays(20)->setTime(23, 59, 59);
    $second = $first->copy()->addSecond();

    $this->travelTo($first);
    LogPartitions::ensure(now());
    $older = makeLogEvent($this->group);

    $this->travelTo($second);
    LogPartitions::ensure(now());
    $newer = makeLogEvent($this->group);

    $firstName = LogPartitions::nameFor($first);
    $secondName = LogPartitions::nameFor($second);

    expect($firstName)->not->toBe($secondName)
        ->and(logEventPartitions())->toContain($firstName, $secondName)
        ->and(DB::table($firstName)->pluck('id')->all())->toBe([$older->id])
        ->and(DB::table($secondName)->pluck('id')->all())->toBe([$newer->id])
        ->and($newer->id)->toBeGreaterThan($older->id);
});

it('ensures a partition idempotently', function () {
    $day = now()->addDays(30);

    $name = LogPartitions::ensure($day);

    expect(LogPartitions::ensure($day))->toBe($name)
        ->and(LogPartitions::ensure($day->copy()->setTime(18, 0)))->toBe($name)
        ->and(array_count_values(logEventPartitions())[$name])->toBe(1);
});

it('names partitions by the UTC day', function () {
    $day = now()->setTimezone('America/Santiago')->setTime(23, 30);

    expect(LogPartitions::nameFor($day))->toBe('log_events_'.$day->copy()->utc()->format('Ymd'));
});

it('fails to insert on a day without partition', function () {
    $this->travelTo(now()->addDays(60));

    makeLogEvent($this->group);
})->throws(QueryException::class, 'no partition of relation');

it('casts attributes and fills received_at', function () {
    $event = makeLogEvent($this->group)->fresh();

    expect($event->level)->toBe(LogLevel::Error)
        ->and($event->context)->toBe(['order' => 42])
        ->and($event->received_at->toDateTimeString())->toBe(now()->toDateTimeString())
        ->and($event->group->is($this->group))->toBeTrue();
});

it('rejects an invalid level with a raw insert', function () {
    DB::table('log_events')->insert([
        'organization_id' => $this->organization->id,
        'project_id' => $this->project->id,
        'log_group_id' => $this->group->id,
        'level' => 'fatal',
        'message' => 'x',
        'occurred_at' => now(),
        'received_at' => now(),
    ]);
})->throws(QueryException::class, 'log_events_level_check');

it('nulls the source and cascades the group on delete', function () {
    $source = LogSource::factory()->for($this->project)->create();
    $event = makeLogEvent($this->group, $source);

    $source->delete();

    expect(DB::table('log_events')->where('id', $event->id)->value('log_source_id'))->toBeNull();

    $this->group->delete();

    expect(DB::table('log_events')->count())->toBe(0);
});

it('isolates events between organizations', function () {
    $mine = makeLogEvent($this->group);
    $foreignGroup = LogGroup::factory()->for(Project::factory()->for($this->other)->create())->create();
    $foreign = makeLogEvent($foreignGroup);

    expect(LogEvent::query()->pluck('id')->all())->toBe([$mine->id])
        ->and(LogEvent::query()->find($foreign->id))->toBeNull();

    app(CurrentOrganization::class)->set($this->other);

    expect(LogEvent::query()->pluck('id')->all())->toBe([$foreign->id]);

    app(CurrentOrganization::class)->set(null);

    expect(LogEvent::query()->count())->toBe(0);
});
