<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\Gate;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();

    $this->task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $this->task->project_id = $this->project->id;
    $this->task->number = 1;
    $this->task->save();

    $this->comment = TaskComment::factory()->forTask($this->task)->create();
});

it('lets a member with access to the project view the comment', function () {
    $member = User::factory()->create();
    $this->organization->addMember($member, [Role::Member]);
    assignMembersToAllProjects();

    expect(Gate::forUser($member)->allows('view', $this->comment))->toBeTrue();
});

it('hides the comment from a member without access to the project', function () {
    $member = User::factory()->create();
    $this->organization->addMember($member, [Role::Member]);

    $response = Gate::forUser($member)->inspect('view', $this->comment);

    expect($response)->toBeInstanceOf(Response::class)
        ->and($response->allowed())->toBeFalse()
        ->and($response->status())->toBe(404);
});

it('denies a user from another organization', function () {
    $other = Organization::factory()->create();
    $outsider = User::factory()->create();
    $other->addMember($outsider, [Role::Owner]);

    expect(Gate::forUser($outsider)->allows('view', $this->comment))->toBeFalse();
});
