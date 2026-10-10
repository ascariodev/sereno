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
    $this->other = Organization::factory()->create();
    $this->creator = User::factory()->create();
    $this->organization->addMember($this->creator, [Role::Member]);
    $this->colleague = User::factory()->create();
    $this->organization->addMember($this->colleague, [Role::Member]);
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'POSVE']);
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = new Task(['title' => 'Doomed', 'status' => 'todo', 'position' => 1.0]);
    $this->task->project_id = $this->project->id;
    $this->task->number = 1;
    $this->task->created_by = $this->creator->id;
    $this->task->save();
});

function deleteTaskAs(User $user, Organization $organization, Project $project, Task $task)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->deleteJson("/api/projects/{$project->id}/tasks/{$task->id}");
}

it('lets the creator and admins delete with 204', function (string $who) {
    deleteTaskAs($this->{$who}, $this->organization, $this->project, $this->task)->assertNoContent();
    expect(Task::withoutGlobalScopes()->whereKey($this->task->id)->exists())->toBeFalse();
})->with(['creator', 'admin']);

it('forbids a member who is not the creator', function () {
    deleteTaskAs($this->colleague, $this->organization, $this->project, $this->task)->assertForbidden();
    expect(Task::withoutGlobalScopes()->whereKey($this->task->id)->exists())->toBeTrue();
});

it('answers 404 when the task belongs to another project and keeps it', function () {
    $sibling = Project::factory()->for($this->organization)->create();

    deleteTaskAs($this->admin, $this->organization, $sibling, $this->task)->assertNotFound();
    expect(Task::withoutGlobalScopes()->whereKey($this->task->id)->exists())->toBeTrue();
});

it('hides tasks of another organization', function () {
    deleteTaskAs($this->outsider, $this->other, $this->project, $this->task)->assertNotFound();
    deleteTaskAs($this->outsider, $this->organization, $this->project, $this->task)->assertForbidden();
    expect(Task::withoutGlobalScopes()->whereKey($this->task->id)->exists())->toBeTrue();
});

it('requires authentication', function () {
    $this->deleteJson("/api/projects/{$this->project->id}/tasks/{$this->task->id}")->assertUnauthorized();
});

it('rejects an archived project in the user language', function () {
    $this->project->forceFill(['archived_at' => now()])->save();
    $this->admin->forceFill(['locale' => 'es'])->save();

    deleteTaskAs($this->admin, $this->organization, $this->project, $this->task)
        ->assertUnprocessable()
        ->assertJsonPath('errors.project.0', 'Este proyecto está archivado y sus tareas no se pueden eliminar.');
    expect(Task::withoutGlobalScopes()->whereKey($this->task->id)->exists())->toBeTrue();
});
