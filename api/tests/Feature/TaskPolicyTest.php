<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\Gate;

function taskPolicyTask(Project $project, ?User $creator = null): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = 1;
    $task->created_by = $creator?->id;
    $task->save();

    return $task;
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();

    $this->users = [];
    foreach (Role::cases() as $role) {
        $user = User::factory()->create();
        $this->organization->addMember($user, [$role]);
        $this->users[$role->value] = $user;
    }

    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->task = taskPolicyTask($this->project, $this->users['member']);
});

it('lets every role view, list, create and update', function (string $role) {
    $gate = Gate::forUser($this->users[$role]);

    expect($gate->allows('viewAny', Task::class))->toBeTrue()
        ->and($gate->allows('view', $this->task))->toBeTrue()
        ->and($gate->allows('create', Task::class))->toBeTrue()
        ->and($gate->allows('update', $this->task))->toBeTrue();
})->with(['member', 'admin', 'owner']);

it('lets the creator, admins and owners delete', function (string $role) {
    expect(Gate::forUser($this->users[$role])->allows('delete', $this->task))->toBeTrue();
})->with(['member', 'admin', 'owner']);

it('denies delete to a member who is not the creator', function () {
    $other = User::factory()->create();
    $this->organization->addMember($other, [Role::Member]);

    expect(Gate::forUser($other)->allows('delete', $this->task))->toBeFalse()
        ->and(Gate::forUser($other)->allows('update', $this->task))->toBeTrue();
});

it('denies everything to a user from another organization', function () {
    $outsider = User::factory()->create();
    $this->other->addMember($outsider, [Role::Owner]);
    $gate = Gate::forUser($outsider);

    expect($gate->allows('viewAny', Task::class))->toBeFalse()
        ->and($gate->allows('view', $this->task))->toBeFalse()
        ->and($gate->allows('create', Task::class))->toBeFalse()
        ->and($gate->allows('update', $this->task))->toBeFalse()
        ->and($gate->allows('delete', $this->task))->toBeFalse();
});

it('denies a task from another organization even to its own creator and admins', function () {
    $foreignProject = Project::factory()->for($this->other)->create();
    app(CurrentOrganization::class)->set($this->other);
    $foreign = taskPolicyTask($foreignProject, $this->users['owner']);
    app(CurrentOrganization::class)->set($this->organization);

    foreach (['owner', 'admin', 'member'] as $role) {
        $gate = Gate::forUser($this->users[$role]);
        expect($gate->allows('view', $foreign))->toBeFalse()
            ->and($gate->allows('update', $foreign))->toBeFalse()
            ->and($gate->allows('delete', $foreign))->toBeFalse();
    }
});
