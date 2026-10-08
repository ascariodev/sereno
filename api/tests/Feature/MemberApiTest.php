<?php

use App\Enums\Role;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->owner = User::factory()->create(['name' => 'Bruno']);
    $this->organization->addMember($this->owner, [Role::Owner]);
});

function listMembers(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)->getJson('/api/members');
}

it('lets any member list the members ordered by name with their role', function (Role $role) {
    $admin = User::factory()->create(['name' => 'Ana']);
    $this->organization->addMember($admin, [Role::Admin]);
    $viewer = User::factory()->create(['name' => 'Carla']);
    $this->organization->addMember($viewer, [$role]);

    $response = listMembers($viewer, $this->organization)->assertOk();

    expect($response->json('data.*.name'))->toBe(['Ana', 'Bruno', 'Carla'])
        ->and($response->json('data.*.role'))->toBe(['admin', 'owner', $role->value]);

    $response->assertJsonStructure(['data' => [['id', 'name', 'email', 'role', 'joined_at']]])
        ->assertJsonMissingPath('data.0.password');
    expect($response->json('data.1.id'))->toBe($this->owner->id)
        ->and($response->json('data.1.email'))->toBe($this->owner->email)
        ->and($response->json('data.1.joined_at'))->toMatch('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/');
})->with([Role::Owner, Role::Admin, Role::Member]);

it('lists only the members of the active organization with the role they have there', function () {
    $other = Organization::factory()->create();
    $stranger = User::factory()->create(['name' => 'Zoe']);
    $other->addMember($stranger, [Role::Owner]);

    $shared = User::factory()->create(['name' => 'Ana']);
    $this->organization->addMember($shared, [Role::Member]);
    $other->addMember($shared, [Role::Admin]);

    $inThis = listMembers($this->owner, $this->organization)->assertOk();
    expect($inThis->json('data.*.name'))->toBe(['Ana', 'Bruno'])
        ->and($inThis->json('data.*.role'))->toBe(['member', 'owner']);

    $inOther = listMembers($stranger, $other)->assertOk();
    expect($inOther->json('data.*.name'))->toBe(['Ana', 'Zoe'])
        ->and($inOther->json('data.*.role'))->toBe(['admin', 'owner']);
});

it('does not run more queries as members grow', function () {
    $count = function (): int {
        $queries = 0;
        DB::listen(function () use (&$queries) {
            $queries++;
        });
        listMembers($this->owner, $this->organization)->assertOk();

        return $queries;
    };

    $this->organization->addMember(User::factory()->create(), [Role::Member]);
    $count();
    $few = $count();

    foreach (range(1, 5) as $i) {
        $this->organization->addMember(User::factory()->create(), [Role::Admin]);
    }
    expect($count())->toBe($few);
});

it('rejects a user outside the organization', function () {
    $outsider = User::factory()->create();

    listMembers($outsider, $this->organization)->assertForbidden();
});

it('requires authentication', function () {
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->getJson('/api/members')
        ->assertUnauthorized();
});

it('requires the organization header', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/members')->assertStatus(400);
});

function changeRole(User $actor, Organization $organization, User|int $target, mixed $role)
{
    Sanctum::actingAs($actor);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->patchJson('/api/members/'.($target instanceof User ? $target->id : $target), ['role' => $role]);
}

function memberWithRole(Organization $organization, Role $role, string $name): User
{
    $user = User::factory()->create(['name' => $name]);
    $organization->addMember($user, [$role]);

    return $user;
}

function roleIn(Organization $organization, User $user): ?string
{
    setPermissionsTeamId($organization->id);

    return $organization->users()->with('roles')->whereKey($user->id)->first()->roles->first()?->name;
}

it('changes roles according to the actor rank', function (Role $actorRole, Role $targetRole, Role $newRole, bool $allowed) {
    $actor = memberWithRole($this->organization, $actorRole, 'Actor');
    $target = memberWithRole($this->organization, $targetRole, 'Target');

    $response = changeRole($actor, $this->organization, $target, $newRole->value);

    if ($allowed) {
        $response->assertOk()
            ->assertJsonPath('data.id', $target->id)
            ->assertJsonPath('data.role', $newRole->value)
            ->assertJsonStructure(['data' => ['id', 'name', 'email', 'role', 'joined_at']]);
        expect(roleIn($this->organization, $target))->toBe($newRole->value);
    } else {
        $response->assertForbidden();
        expect(roleIn($this->organization, $target))->toBe($targetRole->value);
    }
})->with([
    'owner promotes member to owner' => [Role::Owner, Role::Member, Role::Owner, true],
    'owner demotes owner to admin' => [Role::Owner, Role::Owner, Role::Admin, true],
    'owner changes admin to member' => [Role::Owner, Role::Admin, Role::Member, true],
    'admin changes member to admin' => [Role::Admin, Role::Member, Role::Admin, true],
    'admin changes admin to member' => [Role::Admin, Role::Admin, Role::Member, true],
    'admin cannot grant owner' => [Role::Admin, Role::Member, Role::Owner, false],
    'admin cannot touch an owner' => [Role::Admin, Role::Owner, Role::Member, false],
    'member cannot change a member' => [Role::Member, Role::Member, Role::Admin, false],
    'member cannot change an admin' => [Role::Member, Role::Admin, Role::Member, false],
]);

it('handles a user changing their own role', function (Role $actorRole, Role $newRole, bool $allowed) {
    $actor = memberWithRole($this->organization, $actorRole, 'Actor');

    $response = changeRole($actor, $this->organization, $actor, $newRole->value);

    $allowed ? $response->assertOk()->assertJsonPath('data.role', $newRole->value) : $response->assertForbidden();
    expect(roleIn($this->organization, $actor))->toBe($allowed ? $newRole->value : $actorRole->value);
})->with([
    'owner demotes self' => [Role::Owner, Role::Member, true],
    'admin demotes self' => [Role::Admin, Role::Member, true],
    'admin cannot promote self to owner' => [Role::Admin, Role::Owner, false],
    'member cannot promote self' => [Role::Member, Role::Admin, false],
]);

it('returns 422 when demoting the last owner', function () {
    changeRole($this->owner, $this->organization, $this->owner, 'admin')
        ->assertStatus(422)
        ->assertJsonPath('message', __('The organization must keep at least one owner.'));

    expect(roleIn($this->organization, $this->owner))->toBe('owner');
});

it('returns 404 for a user outside the active organization', function () {
    $stranger = memberWithRole(Organization::factory()->create(), Role::Member, 'Zoe');

    changeRole($this->owner, $this->organization, $stranger, 'admin')->assertNotFound();
    changeRole($this->owner, $this->organization, 999999, 'admin')->assertNotFound();
});

it('does not touch the role the member has in another organization', function () {
    $other = Organization::factory()->create();
    $shared = memberWithRole($this->organization, Role::Member, 'Ana');
    $other->addMember($shared, [Role::Admin]);

    changeRole($this->owner, $this->organization, $shared, 'owner')->assertOk();

    expect(roleIn($this->organization, $shared))->toBe('owner')
        ->and(roleIn($other, $shared))->toBe('admin');
});

it('authorizes before validating the role', function () {
    $member = memberWithRole($this->organization, Role::Member, 'Ana');

    changeRole($member, $this->organization, $this->owner, 'nope')->assertForbidden();
    changeRole($this->owner, $this->organization, $member, 'nope')->assertStatus(422)->assertJsonValidationErrors('role');
    changeRole($this->owner, $this->organization, $member, null)->assertStatus(422)->assertJsonValidationErrors('role');
});

it('rejects changing roles from an organization the actor does not belong to', function () {
    $outsider = User::factory()->create();

    changeRole($outsider, $this->organization, $this->owner, 'member')->assertForbidden();
});

it('requires authentication to change a role', function () {
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->patchJson('/api/members/'.$this->owner->id, ['role' => 'member'])
        ->assertUnauthorized();
});

function removeMemberRequest(User $actor, Organization $organization, User|int $target)
{
    Sanctum::actingAs($actor);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->deleteJson('/api/members/'.($target instanceof User ? $target->id : $target));
}

it('removes members according to the actor rank', function (Role $actorRole, Role $targetRole, bool $allowed) {
    $actor = memberWithRole($this->organization, $actorRole, 'Actor');
    $target = memberWithRole($this->organization, $targetRole, 'Target');

    $response = removeMemberRequest($actor, $this->organization, $target);

    if ($allowed) {
        $response->assertNoContent();
        expect($this->organization->users()->whereKey($target->id)->exists())->toBeFalse();
    } else {
        $response->assertForbidden();
        expect($this->organization->users()->whereKey($target->id)->exists())->toBeTrue();
    }
})->with([
    'owner removes owner' => [Role::Owner, Role::Owner, true],
    'owner removes admin' => [Role::Owner, Role::Admin, true],
    'owner removes member' => [Role::Owner, Role::Member, true],
    'admin removes admin' => [Role::Admin, Role::Admin, true],
    'admin removes member' => [Role::Admin, Role::Member, true],
    'admin cannot remove owner' => [Role::Admin, Role::Owner, false],
    'member cannot remove member' => [Role::Member, Role::Member, false],
    'member cannot remove admin' => [Role::Member, Role::Admin, false],
    'member cannot remove owner' => [Role::Member, Role::Owner, false],
]);

it('lets any member leave the organization', function (Role $role) {
    $actor = memberWithRole($this->organization, $role, 'Actor');

    removeMemberRequest($actor, $this->organization, $actor)->assertNoContent();

    expect($this->organization->users()->whereKey($actor->id)->exists())->toBeFalse();
})->with([Role::Owner, Role::Admin, Role::Member]);

it('returns 422 when the last owner leaves or is removed', function () {
    $admin = memberWithRole($this->organization, Role::Admin, 'Ada');

    removeMemberRequest($this->owner, $this->organization, $this->owner)
        ->assertStatus(422)
        ->assertJsonPath('message', __('The organization must keep at least one owner.'));
    removeMemberRequest($admin, $this->organization, $this->owner)->assertForbidden();

    expect(roleIn($this->organization, $this->owner))->toBe('owner');
});

it('returns 404 when removing a user outside the active organization', function () {
    $stranger = memberWithRole(Organization::factory()->create(), Role::Member, 'Zoe');

    removeMemberRequest($this->owner, $this->organization, $stranger)->assertNotFound();
    removeMemberRequest($this->owner, $this->organization, 999999)->assertNotFound();
});

it('does not remove the member from another organization', function () {
    $other = Organization::factory()->create();
    $shared = memberWithRole($this->organization, Role::Member, 'Ana');
    $other->addMember($shared, [Role::Admin]);

    removeMemberRequest($this->owner, $this->organization, $shared)->assertNoContent();

    expect($other->users()->whereKey($shared->id)->exists())->toBeTrue()
        ->and(roleIn($other, $shared))->toBe('admin');
});

it('answers 403 to a removed member on the next request', function () {
    $member = memberWithRole($this->organization, Role::Member, 'Ana');

    removeMemberRequest($this->owner, $this->organization, $member)->assertNoContent();

    listMembers($member, $this->organization)->assertForbidden();
});

it('no longer accepts pending invitations issued by the removed member', function () {
    $admin = memberWithRole($this->organization, Role::Admin, 'Ada');
    $invitee = User::factory()->create();
    Invitation::factory()->withPlainToken('plain')->create([
        'organization_id' => $this->organization->id,
        'email' => $invitee->email,
        'role' => 'member',
        'invited_by' => $admin->id,
    ]);

    removeMemberRequest($this->owner, $this->organization, $admin)->assertNoContent();

    Sanctum::actingAs($invitee);
    test()->postJson('/api/invitations/accept', ['token' => 'plain'])->assertUnprocessable();
    expect($this->organization->users()->whereKey($invitee->id)->exists())->toBeFalse();
});

it('requires authentication to remove a member', function () {
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson('/api/members/'.$this->owner->id)
        ->assertUnauthorized();
});
