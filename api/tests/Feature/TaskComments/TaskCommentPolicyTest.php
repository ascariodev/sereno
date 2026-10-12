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

function commentMember(Role $role = Role::Member): User
{
    $user = User::factory()->create();
    test()->organization->addMember($user, [$role]);
    assignMembersToAllProjects();

    return $user;
}

it('lets only the author update the comment', function () {
    $author = commentMember();
    $comment = TaskComment::factory()->forTask($this->task)->create(['user_id' => $author->id]);

    expect(Gate::forUser($author)->allows('update', $comment))->toBeTrue()
        ->and(Gate::forUser(commentMember())->allows('update', $comment))->toBeFalse()
        ->and(Gate::forUser(commentMember(Role::Admin))->allows('update', $comment))->toBeFalse()
        ->and(Gate::forUser(commentMember(Role::Owner))->allows('update', $comment))->toBeFalse();
});

it('lets the author, admins and owners delete the comment but not other members', function () {
    $author = commentMember();
    $comment = TaskComment::factory()->forTask($this->task)->create(['user_id' => $author->id]);

    expect(Gate::forUser($author)->allows('delete', $comment))->toBeTrue()
        ->and(Gate::forUser(commentMember(Role::Admin))->allows('delete', $comment))->toBeTrue()
        ->and(Gate::forUser(commentMember(Role::Owner))->allows('delete', $comment))->toBeTrue()
        ->and(Gate::forUser(commentMember())->allows('delete', $comment))->toBeFalse();
});

it('denies update and delete to the author without access to the task', function () {
    $author = User::factory()->create();
    $this->organization->addMember($author, [Role::Member]);
    $comment = TaskComment::factory()->forTask($this->task)->create(['user_id' => $author->id]);

    expect(Gate::forUser($author)->allows('update', $comment))->toBeFalse()
        ->and(Gate::forUser($author)->allows('delete', $comment))->toBeFalse();
});

it('denies update and delete from another organization even to an owner', function () {
    $other = Organization::factory()->create();
    $outsider = User::factory()->create();
    $other->addMember($outsider, [Role::Owner]);

    expect(Gate::forUser($outsider)->allows('update', $this->comment))->toBeFalse()
        ->and(Gate::forUser($outsider)->allows('delete', $this->comment))->toBeFalse();
});

it('denies update and delete when the active organization differs from the comment one', function () {
    $author = commentMember(Role::Owner);
    $comment = TaskComment::factory()->forTask($this->task)->create(['user_id' => $author->id]);
    app(CurrentOrganization::class)->set(Organization::factory()->create());

    expect(Gate::forUser($author)->allows('update', $comment))->toBeFalse()
        ->and(Gate::forUser($author)->allows('delete', $comment))->toBeFalse();
});

it('lets admins delete a comment whose author was removed but nobody update it', function () {
    $comment = TaskComment::factory()->forTask($this->task)->create(['user_id' => null]);
    $admin = commentMember(Role::Admin);

    expect(Gate::forUser($admin)->allows('delete', $comment))->toBeTrue()
        ->and(Gate::forUser($admin)->allows('update', $comment))->toBeFalse()
        ->and(Gate::forUser(commentMember())->allows('delete', $comment))->toBeFalse();
});
