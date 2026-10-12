<?php

use App\Enums\Role;
use App\Exceptions\LastOwnerException;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

it('lets a user belong to several organizations', function () {
    $user = User::factory()->create();
    $organizations = Organization::factory()->count(2)->create();

    $user->organizations()->attach($organizations);

    expect($user->organizations()->count())->toBe(2)
        ->and($organizations[0]->users->pluck('id')->all())->toBe([$user->id]);
});

it('rejects duplicate organization slugs', function () {
    Organization::factory()->create(['slug' => 'acme']);

    Organization::factory()->create(['slug' => 'acme']);
})->throws(UniqueConstraintViolationException::class);

it('rejects duplicate memberships', function () {
    $user = User::factory()->create();
    $organization = Organization::factory()->create();

    $organization->users()->attach($user);
    $organization->users()->attach($user);
})->throws(UniqueConstraintViolationException::class);

it('stores the default locale in settings', function () {
    $organization = Organization::factory()->create();

    expect($organization->fresh()->settings['default_locale'])->toBe('en');
});

it('cascades deletion of an organization to its dependent rows', function () {
    $doomed = Organization::factory()->create();
    $kept = Organization::factory()->create();
    $user = User::factory()->create();

    foreach ([$doomed, $kept] as $organization) {
        $organization->users()->attach($user);
        Invitation::factory()->create(['organization_id' => $organization->id, 'invited_by' => $user->id]);
        Project::factory()->create(['organization_id' => $organization->id]);
        app(CurrentOrganization::class)->set($organization);
        $user->unsetRelation('roles')->assignRole(Role::Admin->value);
    }

    $doomed->delete();

    foreach (['organization_user', 'invitations', 'projects', 'model_has_roles'] as $table) {
        expect(DB::table($table)->where('organization_id', $doomed->id)->count())->toBe(0, $table)
            ->and(DB::table($table)->where('organization_id', $kept->id)->count())->toBe(1, $table);
    }
});

function membershipRoleNames(Organization $organization, User $user): array
{
    return DB::table('model_has_roles')
        ->join('roles', 'roles.id', '=', 'model_has_roles.role_id')
        ->where('model_has_roles.organization_id', $organization->id)
        ->where('model_has_roles.model_id', $user->id)
        ->pluck('roles.name')
        ->all();
}

it('replaces the member role only in that organization', function () {
    $organization = Organization::factory()->create();
    $other = Organization::factory()->create();
    $owner = User::factory()->create();
    $user = User::factory()->create();
    $organization->addMember($owner, [Role::Owner]);
    $organization->addMember($user, [Role::Member]);
    $other->addMember($user, [Role::Owner]);

    $organization->changeMemberRole($user, Role::Admin);

    expect(membershipRoleNames($organization, $user))->toBe([Role::Admin->value])
        ->and(membershipRoleNames($other, $user))->toBe([Role::Owner->value]);
});

it('lets an owner be demoted while another owner remains', function () {
    $organization = Organization::factory()->create();
    [$first, $second] = User::factory()->count(2)->create();
    $organization->addMember($first, [Role::Owner]);
    $organization->addMember($second, [Role::Owner]);

    $organization->changeMemberRole($first, Role::Member);

    expect(membershipRoleNames($organization, $first))->toBe([Role::Member->value])
        ->and(membershipRoleNames($organization, $second))->toBe([Role::Owner->value]);
});

it('refuses to demote the last owner', function (Role $role) {
    $organization = Organization::factory()->create();
    $owner = User::factory()->create();
    $organization->addMember($owner, [Role::Owner]);
    $organization->addMember(User::factory()->create(), [Role::Admin]);

    expect(fn () => $organization->changeMemberRole($owner, $role))->toThrow(LastOwnerException::class)
        ->and(membershipRoleNames($organization, $owner))->toBe([Role::Owner->value]);
})->with([Role::Admin, Role::Member]);

it('does not count an owner of another organization as a remaining owner', function () {
    $organization = Organization::factory()->create();
    $other = Organization::factory()->create();
    $owner = User::factory()->create();
    $foreignOwner = User::factory()->create();
    $organization->addMember($owner, [Role::Owner]);
    $organization->addMember($foreignOwner, [Role::Member]);
    $other->addMember($foreignOwner, [Role::Owner]);

    $organization->changeMemberRole($owner, Role::Admin);
})->throws(LastOwnerException::class);

it('lets the last owner keep the owner role', function () {
    $organization = Organization::factory()->create();
    $owner = User::factory()->create();
    $organization->addMember($owner, [Role::Owner]);

    $organization->changeMemberRole($owner, Role::Owner);

    expect(membershipRoleNames($organization, $owner))->toBe([Role::Owner->value]);
});

it('removes the membership and its roles only from that organization', function () {
    $organization = Organization::factory()->create();
    $other = Organization::factory()->create();
    $owner = User::factory()->create();
    $user = User::factory()->create();
    $organization->addMember($owner, [Role::Owner]);
    $organization->addMember($user, [Role::Admin]);
    $other->addMember($user, [Role::Member]);

    $organization->removeMember($user);

    expect($organization->users()->whereKey($user->id)->exists())->toBeFalse()
        ->and(membershipRoleNames($organization, $user))->toBe([])
        ->and($other->users()->whereKey($user->id)->exists())->toBeTrue()
        ->and(membershipRoleNames($other, $user))->toBe([Role::Member->value])
        ->and(membershipRoleNames($organization, $owner))->toBe([Role::Owner->value]);
});

it('lets an owner leave while another owner remains', function () {
    $organization = Organization::factory()->create();
    [$first, $second] = User::factory()->count(2)->create();
    $organization->addMember($first, [Role::Owner]);
    $organization->addMember($second, [Role::Owner]);

    $organization->removeMember($first);

    expect($organization->users()->pluck('users.id')->all())->toBe([$second->id])
        ->and(membershipRoleNames($organization, $first))->toBe([]);
});

it('refuses to remove the last owner', function () {
    $organization = Organization::factory()->create();
    $owner = User::factory()->create();
    $organization->addMember($owner, [Role::Owner]);
    $organization->addMember(User::factory()->create(), [Role::Admin]);

    expect(fn () => $organization->removeMember($owner))->toThrow(LastOwnerException::class)
        ->and($organization->users()->whereKey($owner->id)->exists())->toBeTrue()
        ->and(membershipRoleNames($organization, $owner))->toBe([Role::Owner->value]);
});

it('rejects membership changes for a user outside the organization', function (string $operation) {
    $organization = Organization::factory()->create();
    $organization->addMember(User::factory()->create(), [Role::Owner]);
    $stranger = User::factory()->create();

    $operation === 'change'
        ? $organization->changeMemberRole($stranger, Role::Admin)
        : $organization->removeMember($stranger);
})->with(['change', 'remove'])->throws(ModelNotFoundException::class);

it('restores the permission team after a membership change, even when it throws', function () {
    $organization = Organization::factory()->create();
    $active = Organization::factory()->create();
    $owner = User::factory()->create();
    $member = User::factory()->create();
    $organization->addMember($owner, [Role::Owner]);
    $organization->addMember($member, [Role::Member]);
    setPermissionsTeamId($active->id);

    $organization->changeMemberRole($member, Role::Admin);
    expect(getPermissionsTeamId())->toBe($active->id);

    expect(fn () => $organization->removeMember($owner))->toThrow(LastOwnerException::class)
        ->and(getPermissionsTeamId())->toBe($active->id);
});

it('locks the organization row before checking the remaining owners', function (string $operation) {
    $organization = Organization::factory()->create();
    [$first, $second] = User::factory()->count(2)->create();
    $organization->addMember($first, [Role::Owner]);
    $organization->addMember($second, [Role::Owner]);
    $queries = [];
    DB::listen(function ($query) use (&$queries) {
        $queries[] = $query->sql;
    });

    $operation === 'change'
        ? $organization->changeMemberRole($first, Role::Member)
        : $organization->removeMember($first);

    $sql = collect($queries);
    $lockIndex = $sql->search(fn ($query) => str_contains($query, 'from "organizations"') && str_contains($query, 'for update'));
    $ownerCheckIndex = $sql->search(fn ($query) => str_contains($query, 'from "users"') && str_contains($query, 'exists'));

    expect($lockIndex)->toBeInt()
        ->and($ownerCheckIndex)->toBeInt()
        ->and($lockIndex)->toBeLessThan($ownerCheckIndex);
})->with(['change', 'remove']);

it('renders the last owner error as a translated 422', function () {
    app()->setLocale('es');

    $response = (new LastOwnerException)->render();

    expect($response->getStatusCode())->toBe(422)
        ->and($response->getData(true))->toBe(['message' => 'La organización debe conservar al menos un propietario.']);
});
