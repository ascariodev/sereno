<?php

use App\Enums\Role;
use App\Exceptions\LastOwnerException;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
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

it('keeps the assignments when the removal is rejected', function () {
    expect(fn () => $this->organization->removeMember($this->owner))->toThrow(LastOwnerException::class);

    expect(assigneeOf($this->ownersTask))->toBe($this->owner->id);
});
