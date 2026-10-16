<?php

use App\Enums\Role;
use App\Models\McpOauthGrant;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\RefreshToken;
use Laravel\Passport\Token;
use Laravel\Sanctum\Sanctum;

const CONNECTION_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const CONNECTION_VERIFIER = 'connection-test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz';

function connectionOauthToken(Client $client, User $user, Organization $organization): string
{
    Sanctum::actingAs($user);

    $query = http_build_query([
        'response_type' => 'code',
        'client_id' => $client->getKey(),
        'redirect_uri' => CONNECTION_CALLBACK,
        'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', CONNECTION_VERIFIER, true)), '+/', '-_'), '='),
        'code_challenge_method' => 'S256',
        'scope' => 'mcp:use',
        'state' => 'state',
    ]);
    $redirect = test()->postJson('/api/oauth/authorize?'.$query, ['organization_id' => $organization->id])
        ->assertOk()
        ->json('redirect_url');
    parse_str(parse_url($redirect, PHP_URL_QUERY), $params);

    $token = test()->post('/oauth/token', [
        'grant_type' => 'authorization_code',
        'client_id' => $client->getKey(),
        'redirect_uri' => CONNECTION_CALLBACK,
        'code_verifier' => CONNECTION_VERIFIER,
        'code' => $params['code'],
    ])->assertOk()->json('access_token');

    app('auth')->forgetGuards();
    app(CurrentOrganization::class)->set(null);

    return $token;
}

function connectionsAs(User $user, Organization $organization)
{
    app('auth')->forgetGuards();
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

beforeEach(function () {
    usePassportTestKeys();

    $this->claude = app(ClientRepository::class)
        ->createAuthorizationCodeGrantClient('Claude', [CONNECTION_CALLBACK], false);
    $this->desktop = app(ClientRepository::class)
        ->createAuthorizationCodeGrantClient('Claude desktop', [CONNECTION_CALLBACK], false);
    $this->user = User::factory()->create();
    $this->colleague = User::factory()->create();
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    foreach ([$this->organization, $this->other] as $organization) {
        $organization->addMember($this->user, [Role::Member]);
    }
    $this->organization->addMember($this->colleague, [Role::Member]);
    Project::factory()->for($this->organization)->create(['name' => 'Alpha']);
});

it('lists only the own connections of the active organization', function () {
    connectionOauthToken($this->claude, $this->user, $this->organization);
    connectionOauthToken($this->desktop, $this->user, $this->other);
    connectionOauthToken($this->claude, $this->colleague, $this->organization);

    $mine = McpOauthGrant::query()->where('user_id', $this->user->id)->where('organization_id', $this->organization->id)->sole();

    $response = connectionsAs($this->user, $this->organization)
        ->getJson('/api/oauth-connections')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonStructure(['data' => [['id', 'client' => ['id', 'name'], 'organization' => ['id', 'name'], 'created_at']]])
        ->assertJsonPath('data.0.id', $mine->id)
        ->assertJsonPath('data.0.client.id', $this->claude->getKey())
        ->assertJsonPath('data.0.client.name', 'Claude')
        ->assertJsonPath('data.0.organization.id', $this->organization->id)
        ->assertJsonPath('data.0.organization.name', $this->organization->name);

    expect(array_keys($response->json('data.0')))->toBe(['id', 'client', 'organization', 'created_at']);
});

it('rejects a foreign organization header', function () {
    $stranger = Organization::factory()->create();

    connectionsAs($this->user, $stranger)->getJson('/api/oauth-connections')->assertForbidden();
});

it('revokes a connection and its tokens, and the token stops working on /mcp', function () {
    $token = connectionOauthToken($this->claude, $this->user, $this->organization);
    $keptToken = connectionOauthToken($this->desktop, $this->user, $this->other);
    $colleagueToken = connectionOauthToken($this->claude, $this->colleague, $this->organization);
    $grant = McpOauthGrant::query()->where('user_id', $this->user->id)->where('organization_id', $this->organization->id)->sole();

    $call = fn (string $bearer) => $this->postJson('/mcp', [
        'jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/call',
        'params' => ['name' => 'list-projects', 'arguments' => (object) []],
    ], ['Authorization' => 'Bearer '.$bearer, 'Accept' => 'application/json, text/event-stream']);

    app('auth')->forgetGuards();
    $call($token)->assertOk();

    connectionsAs($this->user, $this->organization)
        ->deleteJson('/api/oauth-connections/'.$grant->id)
        ->assertNoContent();

    $userTokens = fn (Client $client, User $user) => Token::query()->where('user_id', $user->id)->where('client_id', $client->getKey());

    expect(McpOauthGrant::query()->whereKey($grant->id)->exists())->toBeFalse()
        ->and(McpOauthGrant::query()->count())->toBe(2)
        ->and($userTokens($this->claude, $this->user)->sole()->revoked)->toBeTrue()
        ->and(RefreshToken::query()->whereIn('access_token_id', $userTokens($this->claude, $this->user)->select('id'))->sole()->revoked)->toBeTrue()
        ->and($userTokens($this->desktop, $this->user)->sole()->revoked)->toBeFalse()
        ->and($userTokens($this->claude, $this->colleague)->sole()->revoked)->toBeFalse();

    app('auth')->forgetGuards();
    $call($token)->assertUnauthorized();
    app('auth')->forgetGuards();
    $call($keptToken)->assertOk();
    app('auth')->forgetGuards();
    $call($colleagueToken)->assertOk();
});

it('answers 404 to a foreign, other-organization or missing connection, with the same body', function () {
    connectionOauthToken($this->claude, $this->user, $this->organization);
    connectionOauthToken($this->desktop, $this->user, $this->other);
    connectionOauthToken($this->claude, $this->colleague, $this->organization);
    $foreign = McpOauthGrant::query()->where('user_id', $this->colleague->id)->sole();
    $elsewhere = McpOauthGrant::query()->where('user_id', $this->user->id)->where('organization_id', $this->other->id)->sole();

    $missing = connectionsAs($this->user, $this->organization)->deleteJson('/api/oauth-connections/999999');
    $missing->assertNotFound();

    foreach ([$foreign, $elsewhere] as $grant) {
        $response = connectionsAs($this->user, $this->organization)->deleteJson('/api/oauth-connections/'.$grant->id);
        $response->assertNotFound();
        expect($response->getContent())->toBe($missing->getContent());
    }

    expect(McpOauthGrant::query()->count())->toBe(3)
        ->and(Token::query()->where('revoked', true)->count())->toBe(0);
});

it('answers 401 to an OAuth access token on the connection endpoints', function () {
    $token = connectionOauthToken($this->claude, $this->user, $this->organization);
    $grant = McpOauthGrant::query()->sole();
    $headers = ['Authorization' => 'Bearer '.$token, 'X-Organization-Id' => (string) $this->organization->id];

    app('auth')->forgetGuards();
    $this->getJson('/api/oauth-connections', $headers)->assertUnauthorized();

    app('auth')->forgetGuards();
    $this->deleteJson('/api/oauth-connections/'.$grant->id, [], $headers)->assertUnauthorized();

    expect(McpOauthGrant::query()->count())->toBe(1)
        ->and(Token::query()->sole()->revoked)->toBeFalse();
});
