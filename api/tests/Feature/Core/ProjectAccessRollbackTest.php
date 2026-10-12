<?php

use App\Enums\Role;
use App\Events\ProjectAccessChanged;
use App\Jobs\TerminateUserConnections;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Broadcasting\BroadcastEvent;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

function rollbackCall(User $actor, Organization $organization, string $method, string $path, array $payload = [])
{
    Sanctum::actingAs($actor);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)->json($method, "/api/projects/{$path}", $payload);
}

function failOnQuery(string $fragment): void
{
    $armed = true;

    DB::beforeExecuting(function (string $query) use ($fragment, &$armed) {
        if ($armed && str_contains($query, $fragment)) {
            $armed = false;
            throw (new ModelNotFoundException)->setModel(User::class);
        }
    });
}

beforeEach(function () {
    Queue::fake();

    $this->organization = Organization::factory()->create();
    $this->owner = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);

    $this->project = Project::factory()->for($this->organization)->create();
});

it('pushes the access broadcast and the connection cut when the change commits', function () {
    $this->project->addMember($this->member);

    rollbackCall($this->owner, $this->organization, 'DELETE', "{$this->project->id}/members/{$this->member->id}")->assertNoContent();

    Queue::assertPushed(BroadcastEvent::class, fn (BroadcastEvent $job) => $job->event instanceof ProjectAccessChanged);
    Queue::assertPushed(TerminateUserConnections::class);
});

it('emits nothing and keeps the assignment when removing is rolled back', function () {
    $this->project->addMember($this->member);
    $task = new Task(['title' => 'Task', 'position' => 1.0]);
    $task->organization_id = $this->organization->id;
    $task->project_id = $this->project->id;
    $task->number = 1;
    $task->assignee_id = $this->member->id;
    $task->saveQuietly();

    failOnQuery('from "tasks"');

    rollbackCall($this->owner, $this->organization, 'DELETE', "{$this->project->id}/members/{$this->member->id}")->assertNotFound();

    expect($this->project->members()->pluck('users.id')->all())->toBe([$this->member->id])
        ->and(Task::withoutGlobalScopes()->findOrFail($task->id)->assignee_id)->toBe($this->member->id);
    Queue::assertNotPushed(BroadcastEvent::class);
    Queue::assertNotPushed(TerminateUserConnections::class);
});

it('emits nothing and does not assign when granting is rolled back', function () {
    failOnQuery('insert into "project_user"');

    rollbackCall($this->owner, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => $this->member->id])->assertNotFound();

    expect($this->project->members()->count())->toBe(0);
    Queue::assertNotPushed(BroadcastEvent::class);
});

it('answers 404 and emits nothing when the user leaves the organization before the lock', function () {
    $this->project->addMember($this->member);
    beforeOrganizationLock('for update', fn () => $this->organization->removeMember($this->member));
    Queue::fake();

    rollbackCall($this->owner, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => $this->member->id])->assertNotFound();

    Queue::assertNotPushed(BroadcastEvent::class, fn (BroadcastEvent $job) => $job->event instanceof ProjectAccessChanged);
});

it('defers the access broadcast and the connection cut until the outer transaction commits', function () {
    $this->project->addMember($this->member);

    DB::beginTransaction();
    rollbackCall($this->owner, $this->organization, 'DELETE', "{$this->project->id}/members/{$this->member->id}")->assertNoContent();

    Queue::assertNotPushed(BroadcastEvent::class);
    Queue::assertNotPushed(TerminateUserConnections::class);

    DB::rollBack();

    Queue::assertNotPushed(BroadcastEvent::class);
    Queue::assertNotPushed(TerminateUserConnections::class);
});
