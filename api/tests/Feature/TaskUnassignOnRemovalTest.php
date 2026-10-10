<?php

use App\Enums\Role;
use App\Events\TaskUpdated;
use App\Exceptions\LastOwnerException;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;

function removalTask(Organization $organization, User $assignee, int $number): Task
{
    app(CurrentOrganization::class)->set($organization);
    $project = Project::factory()->create(['organization_id' => $organization->id]);
    $task = new Task(['title' => 'Task', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = $number;
    $task->assignee_id = $assignee->id;
    $task->save();

    return $task;
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->owner = User::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
    $this->organization->addMember($this->member, [Role::Member]);
    $this->other->addMember($this->member, [Role::Member]);
    $this->mine = removalTask($this->organization, $this->member, 1);
    $this->elsewhere = removalTask($this->other, $this->member, 1);
    $this->ownersTask = removalTask($this->organization, $this->owner, 2);
});

function assigneeOf(Task $task): ?int
{
    return Task::withoutGlobalScopes()->findOrFail($task->id)->assignee_id;
}

it('unassigns the removed member tasks of that organization only', function () {
    $this->organization->removeMember($this->member);

    expect(assigneeOf($this->mine))->toBeNull()
        ->and(assigneeOf($this->elsewhere))->toBe($this->member->id)
        ->and(assigneeOf($this->ownersTask))->toBe($this->owner->id);
});

it('unassigns tasks when a member leaves by themselves through the API', function () {
    Sanctum::actingAs($this->member);

    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson('/api/members/'.$this->member->id)->assertNoContent();

    expect(assigneeOf($this->mine))->toBeNull()
        ->and(assigneeOf($this->elsewhere))->toBe($this->member->id);
});

function secondTaskOfProject(Task $task, User $assignee): Task
{
    $second = new Task(['title' => 'Second', 'position' => 2.0]);
    $second->project_id = $task->project_id;
    $second->number = 9;
    $second->assignee_id = $assignee->id;
    $second->save();

    return $second;
}

it('broadcasts one TaskUpdated per task unassigned by the removal, to each project channel', function () {
    $second = secondTaskOfProject($this->mine, $this->member);
    $third = removalTask($this->organization, $this->member, 3);
    Event::fake([TaskUpdated::class]);

    $this->organization->removeMember($this->member);

    Event::assertDispatchedTimes(TaskUpdated::class, 3);
    foreach ([$this->mine, $second, $third] as $task) {
        Event::assertDispatched(TaskUpdated::class, fn (TaskUpdated $event) => $event->task['id'] === $task->id
            && $event->task['assignee'] === null
            && $event->broadcastOn()->name === "private-organizations.{$this->organization->id}.projects.{$task->project_id}");
    }
});

it('does not broadcast when the removal is rejected or the member had no tasks', function () {
    Event::fake([TaskUpdated::class]);

    expect(fn () => $this->organization->removeMember($this->owner))->toThrow(LastOwnerException::class);
    $idle = User::factory()->create();
    $this->organization->addMember($idle, [Role::Member]);
    $this->organization->removeMember($idle);

    Event::assertNotDispatched(TaskUpdated::class);
});

it('broadcasts TaskUpdated only for the unassigned user tasks of that project', function () {
    $project = Project::withoutGlobalScopes()->findOrFail($this->mine->project_id);
    $otherProject = Project::factory()->create(['organization_id' => $this->organization->id]);
    $elsewhereInOrg = new Task(['title' => 'Other project', 'position' => 1.0]);
    $elsewhereInOrg->project_id = $otherProject->id;
    $elsewhereInOrg->number = 1;
    $elsewhereInOrg->assignee_id = $this->member->id;
    $elsewhereInOrg->save();
    $project->addMember($this->member);
    $second = secondTaskOfProject($this->mine, $this->owner);
    Event::fake([TaskUpdated::class]);
    Sanctum::actingAs($this->owner);

    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/projects/{$project->id}/members/{$this->member->id}")->assertNoContent();

    Event::assertDispatchedTimes(TaskUpdated::class, 1);
    Event::assertDispatched(TaskUpdated::class, fn (TaskUpdated $event) => $event->task['id'] === $this->mine->id
        && $event->task['assignee'] === null
        && $event->broadcastOn()->name === "private-organizations.{$this->organization->id}.projects.{$project->id}");
    expect(assigneeOf($elsewhereInOrg))->toBe($this->member->id)
        ->and(assigneeOf($second))->toBe($this->owner->id);
});

it('does not broadcast TaskUpdated when removing a project member changes nothing', function () {
    $project = Project::withoutGlobalScopes()->findOrFail($this->mine->project_id);
    Event::fake([TaskUpdated::class]);
    Sanctum::actingAs($this->owner);

    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/projects/{$project->id}/members/{$this->member->id}")->assertNoContent();

    Event::assertNotDispatched(TaskUpdated::class);
});

it('keeps the assignments when the removal is rejected', function () {
    expect(fn () => $this->organization->removeMember($this->owner))->toThrow(LastOwnerException::class);

    expect(assigneeOf($this->ownersTask))->toBe($this->owner->id);
});
