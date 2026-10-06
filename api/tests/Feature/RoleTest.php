<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Spatie\Permission\Models\Role as RoleModel;

beforeEach(function () {
    $this->first = Organization::factory()->create();
    $this->second = Organization::factory()->create();

    $this->user = User::factory()->create();
    $this->user->organizations()->attach([$this->first->id, $this->second->id]);
});

it('seeds the global roles', function () {
    expect(RoleModel::query()->whereNull('organization_id')->pluck('name')->sort()->values()->all())
        ->toBe(collect(Role::cases())->map->value->sort()->values()->all());
});

it('scopes a role to the organization where it was assigned', function () {
    $current = app(CurrentOrganization::class);

    $current->set($this->first);
    $this->user->assignRole(Role::Admin->value);

    expect($this->user->hasRole(Role::Admin->value))->toBeTrue();

    $current->set($this->second);
    $this->user->unsetRelation('roles');

    expect($this->user->hasRole(Role::Admin->value))->toBeFalse();

    $current->set($this->first);
    $this->user->unsetRelation('roles');

    expect($this->user->hasRole(Role::Admin->value))->toBeTrue();
});

it('resolves roles for the organization in the header on each request', function () {
    Route::middleware(['api', 'auth:sanctum', 'organization'])
        ->get('/api/role-test', fn () => ['data' => request()->user()->getRoleNames()]);

    app(CurrentOrganization::class)->set($this->first);
    $this->user->assignRole(Role::Admin->value);

    Sanctum::actingAs($this->user);

    $this->withHeader('X-Organization-Id', (string) $this->first->id)
        ->getJson('/api/role-test')
        ->assertOk()
        ->assertExactJson(['data' => [Role::Admin->value]]);

    $this->withHeader('X-Organization-Id', (string) $this->second->id)
        ->getJson('/api/role-test')
        ->assertOk()
        ->assertExactJson(['data' => []]);
});

it('rejects a duplicate global role', function () {
    expect(fn () => DB::table('roles')->insert([
        'organization_id' => null,
        'name' => Role::Admin->value,
        'guard_name' => 'web',
    ]))->toThrow(UniqueConstraintViolationException::class);
});

it('does not keep the previous organization active after a rejected request', function (array $headers, int $status) {
    Route::middleware(['api', 'auth:sanctum', 'organization'])
        ->get('/api/role-test', fn () => ['data' => request()->user()->getRoleNames()]);

    Sanctum::actingAs($this->user);

    $this->withHeader('X-Organization-Id', (string) $this->first->id)
        ->getJson('/api/role-test')
        ->assertOk();

    $this->withHeaders($headers)->getJson('/api/role-test')->assertStatus($status);

    expect(getPermissionsTeamId())->toBeNull()
        ->and(app(CurrentOrganization::class)->id())->toBeNull();
})->with([
    'foreign organization' => [fn () => ['X-Organization-Id' => (string) Organization::factory()->create()->id], 403],
    'invalid header' => [fn () => ['X-Organization-Id' => 'abc'], 400],
]);
