<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->owner = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);

    $this->mine = Project::factory()->for($this->organization)->create();
    $this->foreign = Project::factory()->for($this->organization)->create();
    $this->mine->addMember($this->member);

    app(CurrentOrganization::class)->set($this->organization);
    $this->foreignTask = new Task(['title' => 'Hidden', 'status' => 'todo', 'position' => 1.0]);
    $this->foreignTask->project_id = $this->foreign->id;
    $this->foreignTask->number = 1;
    $this->foreignTask->created_by = $this->member->id;
    $this->foreignTask->save();
    $this->foreign->forceFill(['last_task_number' => 1])->save();
});

function taskAccessCall(User $user, Organization $organization, string $method, string $path, array $payload = [])
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)->json($method, "/api/projects{$path}", $payload);
}

it('hides the tasks of a project the member is not assigned to', function () {
    $task = $this->foreignTask;
    $base = "/{$this->foreign->id}/tasks";

    taskAccessCall($this->member, $this->organization, 'GET', $base)->assertNotFound();
    taskAccessCall($this->member, $this->organization, 'POST', $base, ['title' => 'New'])->assertNotFound();
    taskAccessCall($this->member, $this->organization, 'PATCH', "{$base}/{$task->id}", ['title' => 'X'])->assertNotFound();
    taskAccessCall($this->member, $this->organization, 'POST', "{$base}/{$task->id}/move", ['status' => 'done'])->assertNotFound();
    taskAccessCall($this->member, $this->organization, 'DELETE', "{$base}/{$task->id}")->assertNotFound();

    expect($task->fresh()->title)->toBe('Hidden')->and($task->fresh()->status->value)->toBe('todo');
});

it('lets owners, admins and assigned members work on the tasks', function (string $who, string $project) {
    $user = $who === 'member' ? $this->member : ($who === 'admin' ? $this->admin : $this->owner);

    taskAccessCall($user, $this->organization, 'GET', "/{$this->$project->id}/tasks")->assertOk();
    taskAccessCall($user, $this->organization, 'POST', "/{$this->$project->id}/tasks", ['title' => 'Ok'])->assertCreated();
})->with([['member', 'mine'], ['admin', 'foreign'], ['owner', 'foreign']]);

it('rejects an assignee without access to the project', function () {
    $stranger = User::factory()->create();
    $this->organization->addMember($stranger, [Role::Member]);

    taskAccessCall($this->admin, $this->organization, 'POST', "/{$this->mine->id}/tasks", ['title' => 'T', 'assignee_id' => $stranger->id])
        ->assertUnprocessable()->assertJsonValidationErrors(['assignee_id']);

    $task = new Task(['title' => 'Mine', 'status' => 'todo', 'position' => 1.0]);
    $task->project_id = $this->mine->id;
    $task->number = 1;
    $task->save();

    taskAccessCall($this->admin, $this->organization, 'PATCH', "/{$this->mine->id}/tasks/{$task->id}", ['assignee_id' => $stranger->id])
        ->assertUnprocessable()->assertJsonValidationErrors(['assignee_id']);

    taskAccessCall($this->admin, $this->organization, 'PATCH', "/{$this->mine->id}/tasks/{$task->id}", ['assignee_id' => $this->member->id])
        ->assertOk();
    taskAccessCall($this->admin, $this->organization, 'PATCH', "/{$this->mine->id}/tasks/{$task->id}", ['assignee_id' => $this->owner->id])
        ->assertOk();
});
