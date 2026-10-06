<?php

use App\Enums\Role;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
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
        Invitation::factory()->create(['organization_id' => $organization->id]);
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
