<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->owner = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->assigned = User::factory()->create();
    $this->organization->addMember($this->assigned, [Role::Member]);
    $this->other = User::factory()->create();
    $this->organization->addMember($this->other, [Role::Member]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->assigned);
});

function projectMembersCall(User $user, Organization $organization, string $method, string $path, array $payload = [])
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)->json($method, "/api/projects/{$path}", $payload);
}

it('lists who sees the project: owners, admins and assigned members', function () {
    $response = projectMembersCall($this->assigned, $this->organization, 'GET', "{$this->project->id}/members")->assertOk();

    expect(collect($response->json('data'))->pluck('id')->all())
        ->toEqualCanonicalizing([$this->owner->id, $this->admin->id, $this->assigned->id]);
    expect($response->json('data.0'))->toHaveKeys(['id', 'name', 'email', 'role', 'joined_at']);
});

it('hides the member list of a project the member is not assigned to', function () {
    projectMembersCall($this->other, $this->organization, 'GET', "{$this->project->id}/members")->assertNotFound();
});

it('lets owners and admins assign a member', function (string $actor) {
    projectMembersCall($this->{$actor}, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => $this->other->id])
        ->assertOk()
        ->assertJsonPath('data.id', $this->other->id)
        ->assertJsonPath('data.role', 'member');

    expect($this->project->members()->pluck('users.id')->all())->toContain($this->other->id);
})->with(['owner', 'admin']);

it('assigns idempotently', function () {
    projectMembersCall($this->admin, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => $this->assigned->id])->assertOk();

    expect($this->project->members()->count())->toBe(1);
});

it('lets owners and admins remove a member', function () {
    projectMembersCall($this->admin, $this->organization, 'DELETE', "{$this->project->id}/members/{$this->assigned->id}")->assertNoContent();

    expect($this->project->members()->count())->toBe(0);
});

it('forbids members from assigning or removing, before validating', function () {
    projectMembersCall($this->assigned, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => 999999])->assertForbidden();
    projectMembersCall($this->assigned, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => $this->other->id])->assertForbidden();
    projectMembersCall($this->assigned, $this->organization, 'DELETE', "{$this->project->id}/members/{$this->assigned->id}")->assertForbidden();

    expect($this->project->members()->pluck('users.id')->all())->toBe([$this->assigned->id]);
});

it('forbids members removing an unknown id instead of revealing it with a 404', function () {
    projectMembersCall($this->assigned, $this->organization, 'DELETE', "{$this->project->id}/members/999999")->assertForbidden();
    projectMembersCall($this->other, $this->organization, 'DELETE', "{$this->project->id}/members/".User::factory()->create()->id)->assertForbidden();
    projectMembersCall($this->admin, $this->organization, 'DELETE', "{$this->project->id}/members/999999")->assertNotFound();
});

it('rejects users that are not members of the organization', function () {
    $stranger = User::factory()->create();
    $foreignOrganization = Organization::factory()->create();
    $foreignOrganization->addMember($stranger, [Role::Member]);

    projectMembersCall($this->admin, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => $stranger->id])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('user_id');
    projectMembersCall($this->admin, $this->organization, 'POST', "{$this->project->id}/members", [])
        ->assertJsonValidationErrors('user_id');

    expect($this->project->members()->count())->toBe(1);
});

it('rejects assigning an owner or admin with the role message', function () {
    projectMembersCall($this->owner, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => $this->admin->id])
        ->assertUnprocessable()
        ->assertJsonPath('errors.user_id.0', 'Only users with the member role can be assigned to a project.');

    expect($this->project->members()->count())->toBe(1);
});

it('rejects removing an owner or admin and 404s for strangers', function () {
    projectMembersCall($this->owner, $this->organization, 'DELETE', "{$this->project->id}/members/{$this->admin->id}")
        ->assertUnprocessable()
        ->assertJsonValidationErrors('user');

    projectMembersCall($this->owner, $this->organization, 'DELETE', "{$this->project->id}/members/".User::factory()->create()->id)
        ->assertNotFound();
});

it('does not reach projects of another organization', function () {
    $foreign = Project::factory()->for(Organization::factory()->create())->create();

    projectMembersCall($this->owner, $this->organization, 'GET', "{$foreign->id}/members")->assertNotFound();
    projectMembersCall($this->owner, $this->organization, 'POST', "{$foreign->id}/members", ['user_id' => $this->other->id])->assertNotFound();
});

it('translates the role message', function () {
    $this->admin->update(['locale' => 'es']);

    projectMembersCall($this->admin, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => $this->owner->id])
        ->assertJsonPath('errors.user_id.0', 'Solo los usuarios con rol member se pueden asignar a un proyecto.');
});

it('rechecks the member role under the organization lock when assigning', function () {
    beforeOrganizationLock('for update', fn () => $this->organization->changeMemberRole($this->other, Role::Admin));

    projectMembersCall($this->owner, $this->organization, 'POST', "{$this->project->id}/members", ['user_id' => $this->other->id])
        ->assertUnprocessable()
        ->assertJsonPath('errors.user_id.0', 'Only users with the member role can be assigned to a project.');

    expect($this->project->members()->pluck('users.id')->all())->toBe([$this->assigned->id]);
});

it('rechecks the member role under the organization lock when removing', function () {
    beforeOrganizationLock('for update', fn () => $this->organization->changeMemberRole($this->assigned, Role::Admin));

    projectMembersCall($this->owner, $this->organization, 'DELETE', "{$this->project->id}/members/{$this->assigned->id}")
        ->assertUnprocessable()
        ->assertJsonPath('errors.user.0', 'Only users with the member role can be removed from a project.');

    expect($this->project->members()->pluck('users.id')->all())->toBe([$this->assigned->id]);
});
