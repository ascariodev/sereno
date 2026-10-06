<?php

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Enums\Role;
use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\LogPartitions;
use Illuminate\Support\Carbon;
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

function asGroupReader(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

function insertGroupEvent(LogGroup $group, Carbon $receivedAt, string $message): LogEvent
{
    LogPartitions::ensure($receivedAt);

    $event = new LogEvent([
        'level' => LogLevel::Error,
        'message' => $message,
        'context' => ['secret' => 'visible'],
        'occurred_at' => $receivedAt,
        'received_at' => $receivedAt,
    ]);
    $event->organization_id = $group->organization_id;
    $event->project_id = $group->project_id;
    $event->log_group_id = $group->id;
    $event->save();

    return $event;
}

it('lists groups of a project ordered by last seen, readable by every role', function () {
    $old = LogGroup::factory()->for($this->project)->create(['last_seen_at' => now()->subHours(3)]);
    $new = LogGroup::factory()->for($this->project)->create(['last_seen_at' => now()->subHour()]);
    LogGroup::factory()->for(Project::factory()->for($this->organization))->create();

    foreach (Role::cases() as $role) {
        asGroupReader($this->users[$role->value], $this->organization)
            ->getJson("/api/projects/{$this->project->id}/log-groups")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $new->id)
            ->assertJsonPath('data.1.id', $old->id)
            ->assertJsonPath('data.0.level', 'error')
            ->assertJsonPath('data.0.status', 'open')
            ->assertJsonMissingPath('data.0.organization_id')
            ->assertJsonMissingPath('data.0.fingerprint')
            ->assertJsonMissingPath('data.0.events');
    }
});

it('breaks last seen ties by id descending', function () {
    $seen = now()->subHour();
    $first = LogGroup::factory()->for($this->project)->create(['last_seen_at' => $seen]);
    $second = LogGroup::factory()->for($this->project)->create(['last_seen_at' => $seen]);

    asGroupReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups")
        ->assertJsonPath('data.0.id', $second->id)
        ->assertJsonPath('data.1.id', $first->id);
});

it('filters by status', function () {
    $open = LogGroup::factory()->for($this->project)->create();
    LogGroup::factory()->for($this->project)->resolved()->create();
    LogGroup::factory()->for($this->project)->ignored()->create();

    asGroupReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups?status=open")
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $open->id);

    asGroupReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups?status=".LogGroupStatus::Resolved->value)
        ->assertJsonCount(1, 'data');
});

it('filters by minimum level', function () {
    foreach ([LogLevel::Debug, LogLevel::Warning, LogLevel::Error, LogLevel::Emergency] as $level) {
        LogGroup::factory()->for($this->project)->create(['level' => $level]);
    }

    $response = asGroupReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups?level=error")
        ->assertOk()
        ->assertJsonCount(2, 'data');

    expect(collect($response->json('data'))->pluck('level')->sort()->values()->all())->toBe(['emergency', 'error']);
});

it('rejects invalid filters and page sizes', function () {
    $reader = asGroupReader($this->users['member'], $this->organization);

    $reader->getJson("/api/projects/{$this->project->id}/log-groups?status=nope")
        ->assertUnprocessable()->assertJsonValidationErrors('status');
    $reader->getJson("/api/projects/{$this->project->id}/log-groups?level=nope")
        ->assertUnprocessable()->assertJsonValidationErrors('level');
    $reader->getJson("/api/projects/{$this->project->id}/log-groups?per_page=101")
        ->assertUnprocessable()->assertJsonValidationErrors('per_page');
});

it('paginates and keeps filters in the links', function () {
    LogGroup::factory()->for($this->project)->count(3)->create();

    asGroupReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups?per_page=2&status=open")
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.total', 3)
        ->assertJsonPath('meta.per_page', 2)
        ->assertJsonPath('links.next', fn ($next) => str_contains($next, 'status=open') && str_contains($next, 'per_page=2'));
});

it('lists groups of an archived project', function () {
    LogGroup::factory()->for($this->project)->create();
    $this->project->forceFill(['archived_at' => now()])->save();

    asGroupReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups")
        ->assertOk()
        ->assertJsonCount(1, 'data');
});

it('shows a group with its latest 50 events newest first without internal fields', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    $base = now()->startOfSecond();

    foreach (range(1, 55) as $i) {
        insertGroupEvent($group, $base->copy()->subMinutes(60 - $i), "event {$i}");
    }

    $response = asGroupReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups/{$group->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $group->id)
        ->assertJsonCount(50, 'data.events')
        ->assertJsonPath('data.events.0.message', 'event 55')
        ->assertJsonPath('data.events.49.message', 'event 6')
        ->assertJsonPath('data.events.0.context.secret', 'visible')
        ->assertJsonMissingPath('data.events.0.organization_id')
        ->assertJsonMissingPath('data.events.0.project_id')
        ->assertJsonMissingPath('data.events.0.log_group_id');

    expect(array_keys($response->json('data.events.0')))
        ->toEqualCanonicalizing(['id', 'level', 'message', 'context', 'occurred_at', 'received_at']);
});

it('omits events older than the retention window', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    insertGroupEvent($group, now()->startOfSecond()->subMinute(), 'recent');
    insertGroupEvent($group, now()->startOfSecond()->subDays(config('workspace.log.retention_days') + 2), 'expired');

    asGroupReader($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups/{$group->id}")
        ->assertJsonCount(1, 'data.events')
        ->assertJsonPath('data.events.0.message', 'recent');
});

it('returns 404 for a group of another project', function () {
    $otherProject = Project::factory()->for($this->organization)->create();
    $group = LogGroup::factory()->for($otherProject)->create();

    asGroupReader($this->users['owner'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups/{$group->id}")
        ->assertNotFound();
});

it('isolates groups between organizations', function () {
    $group = LogGroup::factory()->for($this->project)->create();

    asGroupReader($this->outsider, $this->other)
        ->getJson("/api/projects/{$this->project->id}/log-groups")
        ->assertNotFound();
    asGroupReader($this->outsider, $this->other)
        ->getJson("/api/projects/{$this->project->id}/log-groups/{$group->id}")
        ->assertNotFound();

    asGroupReader($this->outsider, $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups")
        ->assertForbidden();
    asGroupReader($this->outsider, $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-groups/{$group->id}")
        ->assertForbidden();
});

it('lets every role change the status through all transitions', function () {
    foreach (Role::cases() as $role) {
        $group = LogGroup::factory()->for($this->project)->create();

        foreach (['resolved', 'ignored', 'open'] as $status) {
            asGroupReader($this->users[$role->value], $this->organization)
                ->patchJson("/api/projects/{$this->project->id}/log-groups/{$group->id}", ['status' => $status])
                ->assertOk()
                ->assertJsonPath('data.id', $group->id)
                ->assertJsonPath('data.status', $status);

            expect($group->fresh()->status)->toBe(LogGroupStatus::from($status));
        }
    }
});

it('changes the status of a group of an archived project', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    $this->project->forceFill(['archived_at' => now()])->save();

    asGroupReader($this->users['member'], $this->organization)
        ->patchJson("/api/projects/{$this->project->id}/log-groups/{$group->id}", ['status' => 'resolved'])
        ->assertOk();
});

it('rejects an invalid or missing status', function () {
    $group = LogGroup::factory()->for($this->project)->create();

    foreach ([['status' => 'closed'], ['status' => null], []] as $payload) {
        asGroupReader($this->users['owner'], $this->organization)
            ->patchJson("/api/projects/{$this->project->id}/log-groups/{$group->id}", $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('status');
    }

    expect($group->fresh()->status)->toBe(LogGroupStatus::Open);
});

it('returns 404 when updating a group of another project', function () {
    $group = LogGroup::factory()->for(Project::factory()->for($this->organization))->create();

    asGroupReader($this->users['owner'], $this->organization)
        ->patchJson("/api/projects/{$this->project->id}/log-groups/{$group->id}", ['status' => 'resolved'])
        ->assertNotFound();
});

it('isolates status changes between organizations and authorizes before validating', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    $url = "/api/projects/{$this->project->id}/log-groups/{$group->id}";

    asGroupReader($this->outsider, $this->other)->patchJson($url, ['status' => 'resolved'])->assertNotFound();
    asGroupReader($this->outsider, $this->organization)->patchJson($url, ['status' => 'resolved'])->assertForbidden();
    asGroupReader($this->outsider, $this->organization)->patchJson($url, ['status' => 'bogus'])->assertForbidden();

    expect($group->fresh()->status)->toBe(LogGroupStatus::Open);
});
