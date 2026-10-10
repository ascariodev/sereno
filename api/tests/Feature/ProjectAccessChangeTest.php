<?php

use App\Enums\Role;
use App\Events\ProjectAccessChanged;
use App\Jobs\TerminateUserConnections;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

function accessTask(Project $project, ?User $assignee, int $number): Task
{
    $task = new Task(['title' => 'Task', 'position' => 1.0]);
    $task->organization_id = $project->organization_id;
    $task->project_id = $project->id;
    $task->number = $number;
    $task->assignee_id = $assignee?->id;
    $task->saveQuietly();

    return $task;
}

function accessAssigneeOf(Task $task): ?int
{
    return Task::withoutGlobalScopes()->findOrFail($task->id)->assignee_id;
}

function accessCall(User $actor, Organization $organization, string $method, string $path, array $payload = [])
{
    Sanctum::actingAs($actor);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)->json($method, "/api/{$path}", $payload);
}

beforeEach(function () {
    Event::fake([ProjectAccessChanged::class]);
    Queue::fake();

    $this->organization = Organization::factory()->create();
    $this->owner = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->newcomer = User::factory()->create();
    $this->organization->addMember($this->newcomer, [Role::Member]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->sibling = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->member);
    $this->sibling->addMember($this->member);
});

it('broadcasts granted access to the user channel with only ids', function () {
    accessCall($this->admin, $this->organization, 'POST', "projects/{$this->project->id}/members", ['user_id' => $this->newcomer->id])
        ->assertOk();

    Event::assertDispatchedTimes(ProjectAccessChanged::class, 1);
    Event::assertDispatched(ProjectAccessChanged::class, fn (ProjectAccessChanged $event) => $event->broadcastOn()->name === "private-users.{$this->newcomer->id}"
        && $event->broadcastAs() === 'project.access_changed'
        && $event->broadcastWith() === [
            'organization_id' => $this->organization->id,
            'project_id' => $this->project->id,
            'granted' => true,
        ]);
    Queue::assertNotPushed(TerminateUserConnections::class);
});

it('does not broadcast when the member was already assigned', function () {
    accessCall($this->admin, $this->organization, 'POST', "projects/{$this->project->id}/members", ['user_id' => $this->member->id])
        ->assertOk();

    Event::assertNotDispatched(ProjectAccessChanged::class);
});

it('unassigns the removed member tasks of that project only', function () {
    $mine = accessTask($this->project, $this->member, 1);
    $siblingTask = accessTask($this->sibling, $this->member, 1);
    $adminsTask = accessTask($this->project, $this->admin, 2);

    accessCall($this->admin, $this->organization, 'DELETE', "projects/{$this->project->id}/members/{$this->member->id}")
        ->assertNoContent();

    expect(accessAssigneeOf($mine))->toBeNull()
        ->and(accessAssigneeOf($siblingTask))->toBe($this->member->id)
        ->and(accessAssigneeOf($adminsTask))->toBe($this->admin->id);
});

it('broadcasts revoked access with only ids and queues a delayed connection cut', function () {
    accessCall($this->owner, $this->organization, 'DELETE', "projects/{$this->project->id}/members/{$this->member->id}")
        ->assertNoContent();

    Event::assertDispatchedTimes(ProjectAccessChanged::class, 1);
    Event::assertDispatched(ProjectAccessChanged::class, fn (ProjectAccessChanged $event) => $event->broadcastOn()->name === "private-users.{$this->member->id}"
        && $event->broadcastWith() === [
            'organization_id' => $this->organization->id,
            'project_id' => $this->project->id,
            'granted' => false,
        ]);
    Queue::assertPushed(TerminateUserConnections::class, 1);
    Queue::assertPushed(
        TerminateUserConnections::class,
        fn (TerminateUserConnections $job) => $job->userId === $this->member->id && $job->delay === 5,
    );
});

it('does nothing when removing a member that was not assigned', function () {
    $task = accessTask($this->project, $this->newcomer, 1);

    accessCall($this->admin, $this->organization, 'DELETE', "projects/{$this->project->id}/members/{$this->newcomer->id}")
        ->assertNoContent();

    Event::assertNotDispatched(ProjectAccessChanged::class);
    Queue::assertNotPushed(TerminateUserConnections::class);
    expect(accessAssigneeOf($task))->toBe($this->newcomer->id);
});

it('cuts the sockets of an admin demoted to member', function () {
    $this->organization->changeMemberRole($this->admin, Role::Member);

    Queue::assertPushed(TerminateUserConnections::class, 1);
    Queue::assertPushed(
        TerminateUserConnections::class,
        fn (TerminateUserConnections $job) => $job->userId === $this->admin->id && $job->delay === 5,
    );
});

it('cuts the sockets of a demoted owner when another owner remains', function () {
    $this->organization->changeMemberRole($this->admin, Role::Owner);
    Queue::assertNotPushed(TerminateUserConnections::class);

    $this->organization->changeMemberRole($this->owner, Role::Member);

    Queue::assertPushed(TerminateUserConnections::class, fn ($job) => $job->userId === $this->owner->id);
});

it('does not cut sockets on role changes that keep access to every project', function () {
    $this->organization->changeMemberRole($this->member, Role::Admin);
    $this->organization->changeMemberRole($this->admin, Role::Owner);
    $this->organization->changeMemberRole($this->admin, Role::Admin);
    $this->organization->changeMemberRole($this->newcomer, Role::Member);

    Queue::assertNotPushed(TerminateUserConnections::class);
});

it('deletes the project assignments of that organization when the member is removed from it', function () {
    $other = Organization::factory()->create();
    $other->addMember($this->member, [Role::Member]);
    $foreign = Project::factory()->for($other)->create();
    $foreign->addMember($this->member);

    $this->organization->removeMember($this->member);

    expect(DB::table('project_user')->where('user_id', $this->member->id)->pluck('project_id')->all())
        ->toBe([$foreign->id]);
});
