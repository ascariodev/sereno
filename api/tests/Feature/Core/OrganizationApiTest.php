<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->user = User::factory()->create();
    Sanctum::actingAs($this->user);
});

it('creates an organization with the creator as member and owner', function () {
    $response = $this->postJson('/api/organizations', ['name' => 'Acme Corp']);

    $response->assertCreated()
        ->assertJsonPath('data.name', 'Acme Corp')
        ->assertJsonPath('data.slug', 'acme-corp')
        ->assertJsonPath('data.roles', [Role::Owner->value]);

    $organization = Organization::query()->where('slug', 'acme-corp')->firstOrFail();

    expect($organization->users()->whereKey($this->user->id)->exists())->toBeTrue();
    expect(getPermissionsTeamId())->toBeNull();
});

it('resolves slug collisions', function () {
    $this->postJson('/api/organizations', ['name' => 'Acme'])->assertCreated();
    $this->postJson('/api/organizations', ['name' => 'Acme'])
        ->assertCreated()
        ->assertJsonPath('data.slug', 'acme-2');
    $this->postJson('/api/organizations', ['name' => 'Acme'])
        ->assertJsonPath('data.slug', 'acme-3');
});

it('retries when a concurrent request takes the slug between check and insert', function () {
    config(['database.connections.concurrent' => config('database.connections.pgsql')]);
    $concurrent = DB::connection('concurrent');
    $collided = false;

    Organization::creating(function () use (&$collided, $concurrent) {
        if (! $collided) {
            $collided = true;
            $concurrent->table('organizations')->insert([
                'name' => 'Acme',
                'slug' => 'acme',
                'settings' => '{}',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    });

    try {
        $this->postJson('/api/organizations', ['name' => 'Acme'])
            ->assertCreated()
            ->assertJsonPath('data.slug', 'acme-2');

        expect($collided)->toBeTrue();
    } finally {
        $concurrent->table('organizations')->where('slug', 'acme')->delete();
        $concurrent->disconnect();
    }
});

it('requires a name', function () {
    $this->postJson('/api/organizations', [])->assertUnprocessable()->assertJsonValidationErrors('name');
});

it('lists only my organizations with my roles', function () {
    $mine = Organization::factory()->create();
    $mine->addMember($this->user, [Role::Admin, Role::Member]);
    $foreign = Organization::factory()->create();
    $foreign->addMember(User::factory()->create(), [Role::Owner]);

    $response = $this->getJson('/api/organizations')->assertOk();

    expect($response->json('data'))->toHaveCount(1);
    expect($response->json('data.0.id'))->toBe($mine->id);
    expect($response->json('data.0.roles'))->toEqualCanonicalizing(['admin', 'member']);
});

it('restores the previous permission team when assigning roles fails', function () {
    $previous = Organization::factory()->create();
    app(CurrentOrganization::class)->set($previous);

    $organization = Organization::factory()->create();
    $user = User::factory()->create();

    expect(fn () => $organization->addMember($user, ['nonexistent-role']))->toThrow(Exception::class);

    expect(getPermissionsTeamId())->toBe($previous->id);
});
