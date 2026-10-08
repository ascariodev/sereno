<?php

use App\Enums\LogLevel;
use App\Enums\Role;
use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\LogPartitions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();

    $this->users = [];
    foreach (Role::cases() as $role) {
        $user = User::factory()->create();
        $this->organization->addMember($user, [$role]);
        $this->users[$role->value] = $user;
    }

    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->project = Project::factory()->for($this->organization)->create();
});

afterEach(function () {
    Carbon::setTestNow();
});

function asHourlyReader(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

function insertHourlyEvent(LogGroup $group, string $receivedAt): void
{
    $at = Carbon::parse($receivedAt, 'UTC');
    LogPartitions::ensure($at);

    $event = new LogEvent([
        'level' => LogLevel::Error,
        'message' => 'event',
        'occurred_at' => $at,
        'received_at' => $at,
    ]);
    $event->organization_id = $group->organization_id;
    $event->project_id = $group->project_id;
    $event->log_group_id = $group->id;
    $event->save();
}

/** @param array<int, int> $nonZero */
function hourlySeries(array $nonZero): array
{
    return array_replace(array_fill(0, 24, 0), $nonZero);
}

it('counts events per hour oldest first and fills the gaps with zeros, readable by every role', function () {
    Carbon::setTestNow(Carbon::parse('2026-10-08 14:30:00', 'UTC'));
    $busy = LogGroup::factory()->for($this->project)->create();
    $quiet = LogGroup::factory()->for($this->project)->create();

    insertHourlyEvent($busy, '2026-10-07 15:20:00');
    insertHourlyEvent($busy, '2026-10-08 09:00:00');
    insertHourlyEvent($busy, '2026-10-08 09:59:59');
    insertHourlyEvent($busy, '2026-10-08 14:05:00');

    foreach (Role::cases() as $role) {
        asHourlyReader($this->users[$role->value], $this->organization)
            ->getJson("/api/projects/{$this->project->id}/log-groups/hourly?ids={$busy->id},{$quiet->id}")
            ->assertOk()
            ->assertJsonPath('data.from', '2026-10-07T15:00:00.000000Z')
            ->assertJsonPath('data.hours', 24)
            ->assertJsonPath("data.counts.{$busy->id}", hourlySeries([0 => 1, 18 => 2, 23 => 1]))
            ->assertJsonPath("data.counts.{$quiet->id}", hourlySeries([]));
    }
});

it('includes the start of the window and excludes events before it', function () {
    Carbon::setTestNow(Carbon::parse('2026-10-08 14:30:00', 'UTC'));
    $group = LogGroup::factory()->for($this->project)->create();

    insertHourlyEvent($group, '2026-10-07 14:59:59');
    insertHourlyEvent($group, '2026-10-07 15:00:00');
    insertHourlyEvent($group, '2026-10-08 14:59:59');
    insertHourlyEvent($group, '2026-10-08 15:00:00');

    asHourlyReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups/hourly?ids={$group->id}")
        ->assertOk()
        ->assertJsonPath("data.counts.{$group->id}", hourlySeries([0 => 1, 23 => 1]));
});

it('counts across midnight from two daily partitions', function () {
    Carbon::setTestNow(Carbon::parse('2026-10-08 02:30:00', 'UTC'));
    $group = LogGroup::factory()->for($this->project)->create();

    insertHourlyEvent($group, '2026-10-07 23:10:00');
    insertHourlyEvent($group, '2026-10-07 23:50:00');
    insertHourlyEvent($group, '2026-10-08 00:10:00');

    asHourlyReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups/hourly?ids={$group->id}")
        ->assertOk()
        ->assertJsonPath('data.from', '2026-10-07T03:00:00.000000Z')
        ->assertJsonPath("data.counts.{$group->id}", hourlySeries([20 => 2, 21 => 1]));
});

it('omits ids of other projects, other organizations or missing groups', function () {
    Carbon::setTestNow(Carbon::parse('2026-10-08 14:30:00', 'UTC'));
    $own = LogGroup::factory()->for($this->project)->create();
    $sibling = LogGroup::factory()->for(Project::factory()->for($this->organization))->create();
    $foreign = LogGroup::factory()->for(Project::factory()->for($this->other))->create();
    insertHourlyEvent($sibling, '2026-10-08 14:00:00');
    insertHourlyEvent($foreign, '2026-10-08 14:00:00');
    $missing = $foreign->id + 1000;

    $response = asHourlyReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups/hourly?ids={$own->id},{$sibling->id},{$foreign->id},{$missing}")
        ->assertOk();

    expect(array_keys($response->json('data.counts')))->toBe([$own->id]);
});

it('returns an empty counts object when no id belongs to the project', function () {
    $foreign = LogGroup::factory()->for(Project::factory()->for($this->other))->create();

    $response = asHourlyReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups/hourly?ids={$foreign->id}")
        ->assertOk();

    expect($response->getContent())->toContain('"counts":{}');
});

it('rejects missing, empty, invalid or more than 100 ids', function () {
    $reader = asHourlyReader($this->users['member'], $this->organization);
    $url = "/api/projects/{$this->project->id}/log-groups/hourly";

    $reader->getJson($url)->assertUnprocessable()->assertJsonValidationErrors('ids');
    $reader->getJson("{$url}?ids=")->assertUnprocessable()->assertJsonValidationErrors('ids');
    $reader->getJson("{$url}?ids=1,abc")->assertUnprocessable()->assertJsonValidationErrors('ids.1');
    $reader->getJson("{$url}?ids=".implode(',', range(1, 101)))
        ->assertUnprocessable()->assertJsonValidationErrors('ids');
    $reader->getJson("{$url}?ids=".implode(',', range(1, 100)))->assertOk();
});

it('isolates hourly counts between organizations', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    $url = "/api/projects/{$this->project->id}/log-groups/hourly?ids={$group->id}";

    asHourlyReader($this->outsider, $this->other)->getJson($url)->assertNotFound();
    asHourlyReader($this->outsider, $this->organization)->getJson($url)->assertForbidden();
});

it('runs a fixed number of queries regardless of the number of groups', function () {
    Carbon::setTestNow(Carbon::parse('2026-10-08 14:30:00', 'UTC'));
    $groups = LogGroup::factory()->for($this->project)->count(3)->create();
    foreach ($groups as $group) {
        insertHourlyEvent($group, '2026-10-08 10:00:00');
        insertHourlyEvent($group, '2026-10-08 13:00:00');
    }

    $loggedQueries = function (string $ids): array {
        DB::flushQueryLog();
        DB::enableQueryLog();
        asHourlyReader($this->users['member'], $this->organization)
            ->getJson("/api/projects/{$this->project->id}/log-groups/hourly?ids={$ids}")
            ->assertOk();
        DB::disableQueryLog();

        return array_column(DB::getQueryLog(), 'query');
    };

    $loggedQueries((string) $groups[0]->id);
    $single = $loggedQueries((string) $groups[0]->id);
    $many = $loggedQueries($groups->pluck('id')->implode(','));

    expect(count($many))->toBe(count($single))
        ->and(array_filter($many, fn (string $query) => str_contains($query, 'log_events')))->toHaveCount(1);
});
