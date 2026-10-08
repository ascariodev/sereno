<?php

use App\Enums\Role;
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
        ->and($response->json('data.1.joined_at'))->not->toBeNull();
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
