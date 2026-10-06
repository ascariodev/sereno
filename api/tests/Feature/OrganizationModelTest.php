<?php

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;

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
