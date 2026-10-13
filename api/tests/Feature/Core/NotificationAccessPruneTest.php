<?php

use App\Enums\Role;
use App\Events\MembershipRevoked;
use App\Events\ProjectAccessChanged;
use App\Jobs\TerminateUserConnections;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    Queue::fake();

    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->owner = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
    $this->user = User::factory()->create();
    $this->organization->addMember($this->user, [Role::Member]);
    $this->other->addMember($this->user, [Role::Member]);
    $this->bystander = User::factory()->create();
    $this->organization->addMember($this->bystander, [Role::Member]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->sibling = Project::factory()->for($this->organization)->create();
    $this->otherProject = Project::factory()->for($this->other)->create();
    foreach ([$this->project, $this->sibling] as $project) {
        $project->addMember($this->user);
        $project->addMember($this->bystander);
    }
    $this->otherProject->addMember($this->user);
});

function pruneNotification(User $user, Organization $organization, ?Project $project = null): int
{
    return DB::table('notifications')->insertGetId([
        'uuid' => (string) Str::uuid(),
        'organization_id' => $organization->id,
        'user_id' => $user->id,
        'project_id' => $project?->id,
        'type' => 'task_assigned',
        'subject_type' => Project::class,
        'subject_id' => $project?->id ?? 1,
        'data' => json_encode(['title' => 'Hello']),
    ]);
}

/** @return list<int> */
function pruneRemainingIds(): array
{
    return DB::table('notifications')->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();
}

it('deletes every notification of the organization when the membership is revoked', function () {
    pruneNotification($this->user, $this->organization, $this->project);
    pruneNotification($this->user, $this->organization);
    $otherOrganization = pruneNotification($this->user, $this->other, $this->otherProject);
    $bystander = pruneNotification($this->bystander, $this->organization, $this->project);

    $this->organization->removeMember($this->user);

    expect(pruneRemainingIds())->toBe([$otherOrganization, $bystander]);
});

it('deletes the notifications of the organization when the user leaves through the API', function () {
    pruneNotification($this->user, $this->organization, $this->sibling);
    pruneNotification($this->user, $this->organization);
    $otherOrganization = pruneNotification($this->user, $this->other);

    Sanctum::actingAs($this->user);
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/members/{$this->user->id}")
        ->assertNoContent();

    expect(pruneRemainingIds())->toBe([$otherOrganization]);
});

it('deletes only the notifications of the project the member is removed from', function () {
    pruneNotification($this->user, $this->organization, $this->project);
    $sibling = pruneNotification($this->user, $this->organization, $this->sibling);
    $withoutProject = pruneNotification($this->user, $this->organization);
    $otherOrganization = pruneNotification($this->user, $this->other, $this->otherProject);
    $bystander = pruneNotification($this->bystander, $this->organization, $this->project);

    Sanctum::actingAs($this->owner);
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/projects/{$this->project->id}/members/{$this->user->id}")
        ->assertNoContent();

    expect(pruneRemainingIds())->toBe([$sibling, $withoutProject, $otherOrganization, $bystander]);
});

it('deletes the notifications of unassigned projects when an admin is demoted to member', function () {
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);
    $this->sibling->addMember($admin);
    pruneNotification($admin, $this->organization, $this->project);
    $assigned = pruneNotification($admin, $this->organization, $this->sibling);
    $withoutProject = pruneNotification($admin, $this->organization);

    $this->organization->changeMemberRole($admin, Role::Member);

    expect(pruneRemainingIds())->toBe([$assigned, $withoutProject]);
});

it('keeps every notification when the role change still sees all projects', function () {
    $ids = [
        pruneNotification($this->user, $this->organization, $this->project),
        pruneNotification($this->user, $this->organization),
    ];
    $this->project->removeMember($this->user);

    $this->organization->changeMemberRole($this->user, Role::Admin);

    expect(pruneRemainingIds())->toBe($ids);
});

it('reads the current access instead of trusting a stale payload', function () {
    $ids = [
        pruneNotification($this->user, $this->organization, $this->project),
        pruneNotification($this->user, $this->organization),
    ];

    ProjectAccessChanged::dispatch($this->user->id, $this->organization->id, $this->project->id, false);

    expect(pruneRemainingIds())->toBe($ids);
});

it('prunes only unseen projects when a revocation arrives for a user who is still a member', function () {
    $this->project->removeMember($this->user);
    pruneNotification($this->user, $this->organization, $this->project);
    $kept = [
        pruneNotification($this->user, $this->organization, $this->sibling),
        pruneNotification($this->user, $this->organization),
    ];

    MembershipRevoked::dispatch($this->user->id, $this->organization->id);

    expect(pruneRemainingIds())->toBe($kept);
});

it('reports a failed prune without failing the change nor skipping the connection cut', function () {
    Exceptions::fake();
    pruneNotification($this->user, $this->organization, $this->project);
    DB::listen(function (QueryExecuted $query) {
        if (str_starts_with($query->sql, 'delete from "notifications"')) {
            throw new RuntimeException('prune down');
        }
    });

    Sanctum::actingAs($this->owner);
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/projects/{$this->project->id}/members/{$this->user->id}")
        ->assertNoContent();

    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === 'prune down');
    Queue::assertPushed(TerminateUserConnections::class, fn (TerminateUserConnections $job) => $job->userId === $this->user->id);
    expect(DB::table('project_user')->where('project_id', $this->project->id)->where('user_id', $this->user->id)->exists())->toBeFalse();
});
