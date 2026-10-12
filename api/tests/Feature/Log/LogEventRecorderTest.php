<?php

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Events\LogGroupOpened;
use App\Events\LogGroupReopened;
use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Support\CurrentOrganization;
use App\Support\LogEventRecorder;
use App\Support\LogFingerprint;
use App\Support\LogPartitions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    $this->source = LogSource::factory()->for($this->project)->create();
    $this->recorder = app(LogEventRecorder::class);
});

function recordLog(LogSource $source, string $message, array $attributes = []): LogEvent
{
    return app(LogEventRecorder::class)->record($source, array_merge([
        'level' => 'error',
        'message' => $message,
    ], $attributes));
}

function logGroupRows(): array
{
    return DB::table('log_groups')->orderBy('id')->get()->all();
}

it('groups messages that differ only in ids, numbers, uuids, ips, emails and hex', function () {
    $first = recordLog($this->source, 'Order 123 failed for user 7c9e6679-7425-40de-944b-e07fc1f97466 from 10.0.0.1 (ana@example.com) hash a1b2c3d4e5f6a7b8');
    $second = recordLog($this->source, "Order 98765  failed for user 550e8400-e29b-41d4-a716-446655440000 from 192.168.1.20 (bob@test.org)\thash ffffeeee00001111");

    expect($first->log_group_id)->toBe($second->log_group_id)
        ->and(DB::table('log_groups')->count())->toBe(1);
});

it('separates different messages', function () {
    $first = recordLog($this->source, 'Order failed');
    $second = recordLog($this->source, 'Payment failed');

    expect($first->log_group_id)->not->toBe($second->log_group_id);
});

it('uses the explicit fingerprint over the message', function () {
    $first = recordLog($this->source, 'Order failed', ['fingerprint' => 'checkout']);
    $second = recordLog($this->source, 'Something completely different', ['fingerprint' => 'checkout']);
    $third = recordLog($this->source, 'Order failed');

    $group = LogGroup::withoutGlobalScopes()->find($first->log_group_id);

    expect($second->log_group_id)->toBe($first->log_group_id)
        ->and($third->log_group_id)->not->toBe($first->log_group_id)
        ->and($group->fingerprint)->toBe(hash('sha256', 'explicit:checkout'))
        ->and(strlen($group->fingerprint))->toBe(64);
});

it('ignores a blank explicit fingerprint', function () {
    $first = recordLog($this->source, 'Order failed', ['fingerprint' => '  ']);
    $second = recordLog($this->source, 'Order failed');

    expect($first->log_group_id)->toBe($second->log_group_id);
});

it('counts events and tracks first and last seen', function () {
    $start = now()->utc()->startOfSecond();
    $this->travelTo($start);
    $event = recordLog($this->source, 'Order failed');

    $this->travelTo($start->copy()->addMinutes(5)->addMilliseconds(700));
    recordLog($this->source, 'Order failed');
    recordLog($this->source, 'Order failed');

    $group = LogGroup::withoutGlobalScopes()->find($event->log_group_id);

    expect($group->events_count)->toBe(3)
        ->and($group->first_seen_at->toDateTimeString())->toBe($start->toDateTimeString())
        ->and($group->last_seen_at->toDateTimeString())->toBe($start->copy()->addMinutes(5)->toDateTimeString())
        ->and($group->status)->toBe(LogGroupStatus::Open)
        ->and(LogEvent::withoutGlobalScopes()->where('log_group_id', $group->id)->count())->toBe(3);
});

it('keeps the highest level seen', function () {
    $event = recordLog($this->source, 'Disk almost full', ['level' => 'warning']);
    recordLog($this->source, 'Disk almost full', ['level' => LogLevel::Error]);
    recordLog($this->source, 'Disk almost full', ['level' => 'info']);

    $group = LogGroup::withoutGlobalScopes()->find($event->log_group_id);

    expect($group->level)->toBe(LogLevel::Error)
        ->and(LogEvent::withoutGlobalScopes()->orderBy('id')->pluck('level')->map->value->all())
        ->toBe(['warning', 'error', 'info']);
});

it('creates a separate group for the same fingerprint in another project', function () {
    $otherSource = LogSource::factory()->for(Project::factory()->for($this->organization))->create();

    $first = recordLog($this->source, 'Order failed', ['fingerprint' => 'checkout']);
    $second = recordLog($otherSource, 'Order failed', ['fingerprint' => 'checkout']);

    expect($first->log_group_id)->not->toBe($second->log_group_id)
        ->and(collect(logGroupRows())->pluck('project_id')->all())->toBe([$this->project->id, $otherSource->project_id]);
});

it('takes tenant ids from the source even with another organization active', function () {
    app(CurrentOrganization::class)->set(Organization::factory()->create());

    $event = recordLog($this->source, 'Order failed');
    $group = logGroupRows()[0];
    $row = DB::table('log_events')->where('id', $event->id)->first();

    expect($group->organization_id)->toBe($this->organization->id)
        ->and($group->project_id)->toBe($this->project->id)
        ->and($row->organization_id)->toBe($this->organization->id)
        ->and($row->project_id)->toBe($this->project->id)
        ->and($row->log_source_id)->toBe($this->source->id);
});

it('stores the event with received_at in whole seconds and occurred_at from the client', function () {
    $now = now()->utc()->startOfSecond()->addMilliseconds(999);
    $this->travelTo($now);

    $event = recordLog($this->source, 'Order failed', [
        'occurred_at' => '2026-01-02T03:04:05-03:00',
        'context' => ['order' => 42],
    ]);
    $withoutOccurredAt = recordLog($this->source, 'Order failed');

    $row = DB::table('log_events')->where('id', $event->id)->first();

    expect($row->received_at)->toBe($now->copy()->startOfSecond()->toDateTimeString())
        ->and($row->occurred_at)->toBe('2026-01-02 06:04:05')
        ->and(json_decode($row->context, true))->toBe(['order' => 42])
        ->and(DB::table('log_events')->where('id', $withoutOccurredAt->id)->value('occurred_at'))->toBe($row->received_at);
});

it('creates the partition of the day when missing', function () {
    $day = now()->utc()->addDays(40)->setTime(23, 59, 59);
    $this->travelTo($day->copy()->addMilliseconds(600));

    expect(LogPartitions::exists($day))->toBeFalse();

    $event = recordLog($this->source, 'Order failed');

    expect(DB::table(LogPartitions::nameFor($day))->pluck('id')->all())->toBe([$event->id]);
});

it('uses the first line of the message as a truncated title', function () {
    $event = recordLog($this->source, "\n  ".str_repeat('á', LogGroup::TITLE_MAX_LENGTH + 50)."\n#0 stack trace");
    recordLog($this->source, "Short title\nsecond line");

    $titles = collect(logGroupRows())->pluck('title')->all();

    expect(mb_strlen($titles[0]))->toBe(LogGroup::TITLE_MAX_LENGTH)
        ->and($titles[0])->toBe(str_repeat('á', LogGroup::TITLE_MAX_LENGTH))
        ->and($titles[1])->toBe('Short title')
        ->and($event->log_group_id)->toBe(logGroupRows()[0]->id);
});

it('handles a huge message', function () {
    $message = str_repeat('Order 12345 failed 7c9e6679-7425-40de-944b-e07fc1f97466 ', 20000);

    $event = recordLog($this->source, $message);

    expect(DB::table('log_events')->where('id', $event->id)->value('message'))->toBe($message)
        ->and(LogFingerprint::normalize($message))->toStartWith('Order <n> failed <uuid> ')
        ->and(strlen(LogFingerprint::normalize($message)))->toBeLessThanOrEqual(LogFingerprint::MESSAGE_MAX_BYTES);
});

it('reopens a resolved group on a new event and keeps counting', function () {
    $event = recordLog($this->source, 'Order failed');
    $group = LogGroup::withoutGlobalScopes()->find($event->log_group_id);
    $group->update(['status' => LogGroupStatus::Resolved]);

    recordLog($this->source, 'Order failed');

    $group->refresh();
    expect($group->status)->toBe(LogGroupStatus::Open)
        ->and($group->events_count)->toBe(2);
});

it('keeps an ignored group ignored while counting new events', function () {
    $event = recordLog($this->source, 'Order failed');
    $group = LogGroup::withoutGlobalScopes()->find($event->log_group_id);
    $group->update(['status' => LogGroupStatus::Ignored]);

    recordLog($this->source, 'Order failed');

    $group->refresh();
    expect($group->status)->toBe(LogGroupStatus::Ignored)
        ->and($group->events_count)->toBe(2);
});

it('keeps an open group open on a new event', function () {
    $event = recordLog($this->source, 'Order failed');
    recordLog($this->source, 'Order failed');

    $group = LogGroup::withoutGlobalScopes()->find($event->log_group_id);
    expect($group->status)->toBe(LogGroupStatus::Open)->and($group->events_count)->toBe(2);
});

it('dispatches LogGroupOpened with the group data when a group is created', function () {
    Event::fake([LogGroupOpened::class, LogGroupReopened::class]);

    $event = recordLog($this->source, "Order 42 failed\nstack trace", ['level' => 'critical']);

    Event::assertDispatchedTimes(LogGroupOpened::class, 1);
    Event::assertDispatched(LogGroupOpened::class, fn (LogGroupOpened $opened) => $opened->organizationId === $this->organization->id
        && $opened->projectId === $this->project->id
        && $opened->logGroupId === $event->log_group_id
        && $opened->level === 'critical'
        && $opened->title === 'Order 42 failed'
        && $opened->eventsCount === 1);
    Event::assertNotDispatched(LogGroupReopened::class);
});

it('dispatches nothing for a new event in an open group', function () {
    recordLog($this->source, 'Order failed');
    Event::fake([LogGroupOpened::class, LogGroupReopened::class]);

    recordLog($this->source, 'Order failed');

    Event::assertNotDispatched(LogGroupOpened::class);
    Event::assertNotDispatched(LogGroupReopened::class);
});

it('dispatches LogGroupReopened when a new event reopens a resolved group', function () {
    $event = recordLog($this->source, 'Order failed', ['level' => 'warning']);
    LogGroup::withoutGlobalScopes()->find($event->log_group_id)->update(['status' => LogGroupStatus::Resolved]);
    Event::fake([LogGroupOpened::class, LogGroupReopened::class]);

    recordLog($this->source, 'Order failed', ['level' => 'error']);

    Event::assertDispatchedTimes(LogGroupReopened::class, 1);
    Event::assertDispatched(LogGroupReopened::class, fn (LogGroupReopened $reopened) => $reopened->organizationId === $this->organization->id
        && $reopened->projectId === $this->project->id
        && $reopened->logGroupId === $event->log_group_id
        && $reopened->level === 'error'
        && $reopened->title === 'Order failed'
        && $reopened->eventsCount === 2);
    Event::assertNotDispatched(LogGroupOpened::class);
});

it('dispatches nothing for a new event in an ignored group', function () {
    $event = recordLog($this->source, 'Order failed');
    LogGroup::withoutGlobalScopes()->find($event->log_group_id)->update(['status' => LogGroupStatus::Ignored]);
    Event::fake([LogGroupOpened::class, LogGroupReopened::class]);

    recordLog($this->source, 'Order failed');

    Event::assertNotDispatched(LogGroupOpened::class);
    Event::assertNotDispatched(LogGroupReopened::class);
});

it('waits for the commit before dispatching the group events', function () {
    Event::fake([LogGroupOpened::class, LogGroupReopened::class]);

    expect(fn () => DB::transaction(function () {
        recordLog($this->source, 'Order failed');

        throw new RuntimeException('rollback');
    }))->toThrow(RuntimeException::class);

    Event::assertNotDispatched(LogGroupOpened::class);
});

it('does not dispatch LogGroupReopened when the transaction of a resolved group rolls back', function () {
    $event = recordLog($this->source, 'Order failed');
    LogGroup::withoutGlobalScopes()->find($event->log_group_id)->update(['status' => LogGroupStatus::Resolved]);
    Event::fake([LogGroupOpened::class, LogGroupReopened::class]);

    expect(fn () => DB::transaction(function () {
        recordLog($this->source, 'Order failed');

        throw new RuntimeException('rollback');
    }))->toThrow(RuntimeException::class);

    Event::assertNotDispatched(LogGroupReopened::class);
    Event::assertNotDispatched(LogGroupOpened::class);
});
