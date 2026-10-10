<?php

use App\Enums\Role;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'POSVE']);
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = new Task(['title' => 'Old', 'description' => 'Old text', 'status' => 'in_review', 'position' => 1.0]);
    $this->task->project_id = $this->project->id;
    $this->task->number = 1;
    $this->task->assignee_id = $this->member->id;
    $this->task->save();
});

function patchTaskAs(User $user, Organization $organization, Project $project, Task $task, array $payload)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->patchJson("/api/projects/{$project->id}/tasks/{$task->id}", $payload);
}

it('edits title, description and assignee and returns the full resource', function () {
    $group = LogGroup::factory()->for($this->project)->create(['events_count' => 4]);
    $this->task->log_group_id = $group->id;
    $this->task->save();
    $colleague = User::factory()->create();
    $this->organization->addMember($colleague, [Role::Member]);

    patchTaskAs($this->member, $this->organization, $this->project, $this->task, [
        'title' => 'New', 'description' => 'New text', 'assignee_id' => $colleague->id,
    ])->assertOk()
        ->assertJsonPath('data.key', 'POSVE-1')
        ->assertJsonPath('data.title', 'New')
        ->assertJsonPath('data.description', 'New text')
        ->assertJsonPath('data.status', 'in_review')
        ->assertJsonPath('data.assignee.id', $colleague->id)
        ->assertJsonPath('data.log_group.events_count', 4);

    $fresh = $this->task->fresh();
    expect($fresh->title)->toBe('New')->and($fresh->assignee_id)->toBe($colleague->id);
});

it('leaves absent fields untouched and clears with null', function () {
    patchTaskAs($this->member, $this->organization, $this->project, $this->task, ['title' => 'Only title'])
        ->assertOk()
        ->assertJsonPath('data.description', 'Old text')
        ->assertJsonPath('data.assignee.id', $this->member->id);

    patchTaskAs($this->member, $this->organization, $this->project, $this->task, [
        'description' => null, 'assignee_id' => null,
    ])->assertOk()
        ->assertJsonPath('data.title', 'Only title')
        ->assertJsonPath('data.description', null)
        ->assertJsonPath('data.assignee', null);
});

it('does not change status, position or number', function () {
    patchTaskAs($this->member, $this->organization, $this->project, $this->task, [
        'title' => 'X', 'status' => 'done', 'position' => 99, 'number' => 7,
    ])->assertOk();

    $fresh = $this->task->fresh();
    expect($fresh->status->value)->toBe('in_review')
        ->and($fresh->position)->toEqual(1.0)
        ->and($fresh->number)->toBe(1);
});

it('validates title and description', function (array $payload, string $field) {
    patchTaskAs($this->member, $this->organization, $this->project, $this->task, $payload)
        ->assertUnprocessable()->assertJsonValidationErrors([$field]);
    expect($this->task->fresh()->title)->toBe('Old');
})->with([
    'empty title' => [['title' => ''], 'title'],
    'null title' => [['title' => null], 'title'],
    'long title' => [['title' => str_repeat('a', 201)], 'title'],
    'nul in title' => [['title' => "a\x00b"], 'title'],
    'long description' => [['description' => str_repeat('a', 10001)], 'description'],
    'nul in description' => [['description' => "a\x00b"], 'description'],
]);

it('rejects an assignee outside the organization', function () {
    patchTaskAs($this->member, $this->organization, $this->project, $this->task, ['assignee_id' => $this->outsider->id])
        ->assertUnprocessable()->assertJsonValidationErrors(['assignee_id']);
    expect($this->task->fresh()->assignee_id)->toBe($this->member->id);
});

it('answers 404 when the task belongs to another project', function () {
    $sibling = Project::factory()->for($this->organization)->create();

    patchTaskAs($this->member, $this->organization, $sibling, $this->task, ['title' => 'X'])->assertNotFound();
    expect($this->task->fresh()->title)->toBe('Old');
});

it('hides tasks of another organization before validating', function () {
    patchTaskAs($this->outsider, $this->other, $this->project, $this->task, ['title' => ''])->assertNotFound();
    patchTaskAs($this->outsider, $this->organization, $this->project, $this->task, ['title' => ''])->assertForbidden();
    expect($this->task->fresh()->title)->toBe('Old');
});

it('requires authentication', function () {
    $this->patchJson("/api/projects/{$this->project->id}/tasks/{$this->task->id}", ['title' => 'X'])->assertUnauthorized();
});

it('rejects an archived project in the user language', function () {
    $this->project->forceFill(['archived_at' => now()])->save();
    $this->member->forceFill(['locale' => 'es'])->save();

    patchTaskAs($this->member, $this->organization, $this->project, $this->task, ['title' => 'X'])
        ->assertUnprocessable()
        ->assertJsonPath('errors.project.0', 'Este proyecto está archivado y sus tareas no se pueden editar.');
    expect($this->task->fresh()->title)->toBe('Old');
});
