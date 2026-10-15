<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->user = User::factory()->create();
    $this->organization->addMember($this->user, [Role::Member]);
});

function asUserIn(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

it('creates an access token and returns the plain text once', function () {
    $response = asUserIn($this->user, $this->organization)
        ->postJson('/api/access-tokens', ['name' => 'Claude Code', 'expires_in_days' => 30])
        ->assertCreated()
        ->assertJsonPath('data.name', 'Claude Code')
        ->assertJsonStructure(['data' => ['id', 'name', 'last_used_at', 'expires_at', 'created_at'], 'token']);

    $token = PersonalAccessToken::findToken($response->json('token'));
    expect($token->organization_id)->toBe($this->organization->id)
        ->and($token->tokenable_id)->toBe($this->user->id)
        ->and($token->can('mcp'))->toBeTrue()
        ->and($token->expires_at->isSameDay(now()->addDays(30)))->toBeTrue();
});

it('creates a token without expiration', function () {
    asUserIn($this->user, $this->organization)
        ->postJson('/api/access-tokens', ['name' => 'forever'])
        ->assertCreated()
        ->assertJsonPath('data.expires_at', null);
});

it('validates the name and the expiration', function (array $payload, string $field) {
    asUserIn($this->user, $this->organization)
        ->postJson('/api/access-tokens', $payload)
        ->assertUnprocessable()
        ->assertJsonValidationErrors($field);
})->with([
    'missing name' => [[], 'name'],
    'long name' => [['name' => str_repeat('a', 101)], 'name'],
    'bad expiration' => [['name' => 'x', 'expires_in_days' => 7], 'expires_in_days'],
]);

it('lists only own access tokens of the active organization', function () {
    $other = Organization::factory()->create();
    $other->addMember($this->user, [Role::Member]);
    $stranger = User::factory()->create();
    $this->organization->addMember($stranger, [Role::Member]);

    $mine = $this->user->createAccessToken($this->organization, 'mine')->accessToken;
    $this->user->createAccessToken($other, 'other org');
    $this->user->createToken('web session');
    $stranger->createAccessToken($this->organization, 'stranger');

    $response = asUserIn($this->user, $this->organization)->getJson('/api/access-tokens')->assertOk();

    expect($response->json('data'))->toHaveCount(1)
        ->and($response->json('data.0.id'))->toBe($mine->id)
        ->and($response->json('data.0'))->not->toHaveKey('token');
});

it('revokes an own access token', function () {
    $token = $this->user->createAccessToken($this->organization, 'mine')->accessToken;

    asUserIn($this->user, $this->organization)->deleteJson('/api/access-tokens/'.$token->id)->assertNoContent();

    expect(PersonalAccessToken::query()->whereKey($token->id)->exists())->toBeFalse();
});

it('answers 404 when revoking tokens of others, of other organizations or sessions', function () {
    $other = Organization::factory()->create();
    $other->addMember($this->user, [Role::Member]);
    $stranger = User::factory()->create();
    $this->organization->addMember($stranger, [Role::Member]);

    $ids = [
        $stranger->createAccessToken($this->organization, 'stranger')->accessToken->id,
        $this->user->createAccessToken($other, 'other org')->accessToken->id,
        $this->user->createToken('web')->accessToken->id,
    ];

    foreach ($ids as $id) {
        asUserIn($this->user, $this->organization)->deleteJson('/api/access-tokens/'.$id)->assertNotFound();
    }

    expect(PersonalAccessToken::query()->whereKey($ids)->count())->toBe(3);
});

it('requires authentication', function () {
    $this->getJson('/api/access-tokens')->assertUnauthorized();
});
