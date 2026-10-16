<?php

use App\Models\McpOauthGrant;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\QueryException;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;

function createMcpClient(): Client
{
    return app(ClientRepository::class)
        ->createAuthorizationCodeGrantClient('Claude', ['https://claude.ai/api/mcp/auth_callback'], false);
}

function createMcpGrant(Client $client, User $user, Organization $organization): McpOauthGrant
{
    $grant = new McpOauthGrant;
    $grant->client_id = $client->getKey();
    $grant->user_id = $user->id;
    $grant->organization_id = $organization->id;
    $grant->save();

    return $grant;
}

it('links a client and a user to an organization', function () {
    $client = createMcpClient();
    $user = User::factory()->create();
    $organization = Organization::factory()->create();

    $grant = createMcpGrant($client, $user, $organization)->fresh();

    expect($grant->client->is($client))->toBeTrue()
        ->and($grant->user->is($user))->toBeTrue()
        ->and($grant->organization->is($organization))->toBeTrue();
});

it('rejects a second grant for the same client and user', function () {
    $client = createMcpClient();
    $user = User::factory()->create();
    createMcpGrant($client, $user, Organization::factory()->create());

    expect(fn () => createMcpGrant($client, $user, Organization::factory()->create()))
        ->toThrow(QueryException::class);
});

it('allows the same client for another user and the same user for another client', function () {
    $client = createMcpClient();
    $user = User::factory()->create();
    $organization = Organization::factory()->create();
    createMcpGrant($client, $user, $organization);

    createMcpGrant($client, User::factory()->create(), $organization);
    createMcpGrant(createMcpClient(), $user, $organization);

    expect(McpOauthGrant::query()->count())->toBe(3);
});

it('deletes the grants with their user, organization or client', function (string $doomed) {
    $client = createMcpClient();
    $user = User::factory()->create();
    $organization = Organization::factory()->create();
    createMcpGrant($client, $user, $organization);
    $kept = createMcpGrant(createMcpClient(), User::factory()->create(), Organization::factory()->create());

    ['user' => $user, 'organization' => $organization, 'client' => $client][$doomed]->delete();

    expect(McpOauthGrant::query()->pluck('id')->all())->toBe([$kept->id]);
})->with(['user', 'organization', 'client']);
