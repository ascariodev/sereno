<?php

use App\Enums\Role;
use App\Models\McpOauthGrant;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Token;
use Laravel\Sanctum\Sanctum;

const OAUTH_CONSENT_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const OAUTH_CONSENT_VERIFIER = 'consent-test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz';

function oauthConsentChallenge(string $verifier): string
{
    return rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
}

function oauthConsentQuery(Client $client, array $overrides = []): string
{
    $params = array_merge([
        'response_type' => 'code',
        'client_id' => $client->getKey(),
        'redirect_uri' => OAUTH_CONSENT_CALLBACK,
        'code_challenge' => oauthConsentChallenge(OAUTH_CONSENT_VERIFIER),
        'code_challenge_method' => 'S256',
        'scope' => 'mcp:use',
        'state' => 'state-123',
        'resource' => url('/mcp'),
    ], $overrides);

    return '/api/oauth/authorize?'.http_build_query(array_filter($params, fn ($value) => $value !== null));
}

function oauthConsentCall(string $method, string $url, ?Organization $organization = null)
{
    return match ($method) {
        'get' => test()->getJson($url),
        'post' => test()->postJson($url, ['organization_id' => $organization?->id]),
        'delete' => test()->deleteJson($url),
    };
}

function oauthConsentNothingIssued(): void
{
    expect(McpOauthGrant::query()->count())->toBe(0)
        ->and(DB::table('oauth_auth_codes')->count())->toBe(0);
}

beforeEach(function () {
    usePassportTestKeys();

    $this->client = app(ClientRepository::class)
        ->createAuthorizationCodeGrantClient('Claude', [OAUTH_CONSENT_CALLBACK], false);
    $this->user = User::factory()->create();
    $this->organization = Organization::factory()->create(['name' => 'Beta']);
    $this->second = Organization::factory()->create(['name' => 'Alpha']);
    $this->foreign = Organization::factory()->create();
    $this->organization->addMember($this->user, [Role::Member]);
    $this->second->addMember($this->user, [Role::Owner]);
    Sanctum::actingAs($this->user);
});

it('shows the client, the redirect host and the user organizations', function () {
    $this->getJson(oauthConsentQuery($this->client))
        ->assertOk()
        ->assertExactJson([
            'client' => ['id' => $this->client->getKey(), 'name' => 'Claude'],
            'redirect_host' => 'claude.ai',
            'scopes' => ['mcp:use'],
            'organizations' => [
                ['id' => $this->second->id, 'name' => 'Alpha'],
                ['id' => $this->organization->id, 'name' => 'Beta'],
            ],
        ]);
});

it('rejects a request without redirect_uri when the client has several registered', function () {
    $client = app(ClientRepository::class)
        ->createAuthorizationCodeGrantClient('Claude', [OAUTH_CONSENT_CALLBACK, 'https://claude.ai/api/mcp/other'], false);

    $this->getJson(oauthConsentQuery($client, ['redirect_uri' => null]))
        ->assertStatus(400)
        ->assertJsonPath('error', 'invalid_client')
        ->assertJsonMissingPath('redirect_host');
});

it('asks for the mcp scope when the request has none', function () {
    $this->getJson(oauthConsentQuery($this->client, ['scope' => null]))
        ->assertOk()
        ->assertJsonPath('scopes', ['mcp:use']);
});

it('approves with an organization and exchanges the code for access and refresh tokens', function () {
    $redirect = $this->postJson(oauthConsentQuery($this->client), ['organization_id' => $this->organization->id])
        ->assertOk()
        ->json('redirect_url');

    expect($redirect)->toStartWith(OAUTH_CONSENT_CALLBACK.'?');
    parse_str(parse_url($redirect, PHP_URL_QUERY), $query);
    expect($query['state'])->toBe('state-123');

    $grant = McpOauthGrant::query()->sole();
    expect($grant->client_id)->toBe($this->client->getKey())
        ->and($grant->user_id)->toBe($this->user->id)
        ->and($grant->organization_id)->toBe($this->organization->id);

    $this->post('/oauth/token', [
        'grant_type' => 'authorization_code',
        'client_id' => $this->client->getKey(),
        'redirect_uri' => OAUTH_CONSENT_CALLBACK,
        'code_verifier' => OAUTH_CONSENT_VERIFIER,
        'code' => $query['code'],
    ])
        ->assertOk()
        ->assertJsonPath('token_type', 'Bearer')
        ->assertJsonStructure(['access_token', 'refresh_token', 'expires_in']);

    $token = Token::query()->sole();
    expect($token->user_id)->toBe($this->user->id)
        ->and($token->client_id)->toBe($this->client->getKey())
        ->and($token->scopes)->toBe(['mcp:use']);
});

it('rejects the code with another code verifier', function () {
    $redirect = $this->postJson(oauthConsentQuery($this->client), ['organization_id' => $this->organization->id])
        ->json('redirect_url');
    parse_str(parse_url($redirect, PHP_URL_QUERY), $query);

    $this->post('/oauth/token', [
        'grant_type' => 'authorization_code',
        'client_id' => $this->client->getKey(),
        'redirect_uri' => OAUTH_CONSENT_CALLBACK,
        'code_verifier' => strrev(OAUTH_CONSENT_VERIFIER),
        'code' => $query['code'],
    ])->assertStatus(400)->assertJson(['error' => 'invalid_grant']);

    expect(Token::query()->count())->toBe(0);
});

it('moves the grant to the organization chosen in a new approval', function () {
    $this->postJson(oauthConsentQuery($this->client), ['organization_id' => $this->organization->id])->assertOk();
    $this->postJson(oauthConsentQuery($this->client), ['organization_id' => $this->second->id])->assertOk();

    expect(McpOauthGrant::query()->sole()->organization_id)->toBe($this->second->id);
});

it('denies with access_denied and the state, without a grant or a code', function () {
    $redirect = $this->deleteJson(oauthConsentQuery($this->client))
        ->assertOk()
        ->json('redirect_url');

    expect($redirect)->toStartWith(OAUTH_CONSENT_CALLBACK.'?');
    parse_str(parse_url($redirect, PHP_URL_QUERY), $query);
    expect($query['error'])->toBe('access_denied')
        ->and($query['state'])->toBe('state-123')
        ->and($query)->not->toHaveKey('code');
    oauthConsentNothingIssued();
});

it('requires pkce with S256', function (string $method, array $overrides) {
    oauthConsentCall($method, oauthConsentQuery($this->client, $overrides), $this->organization)
        ->assertStatus(400)
        ->assertExactJson(['error' => 'invalid_request', 'message' => 'The authorization request is invalid.']);

    oauthConsentNothingIssued();
})->with(['get', 'post', 'delete'])->with([
    'plain' => [['code_challenge' => OAUTH_CONSENT_VERIFIER, 'code_challenge_method' => 'plain']],
    'method missing' => [['code_challenge' => OAUTH_CONSENT_VERIFIER, 'code_challenge_method' => null]],
    'challenge missing' => [['code_challenge' => null, 'code_challenge_method' => null]],
    'S256 without challenge' => [['code_challenge' => null]],
]);

it('rejects unknown clients and redirect uris', function (string $method, string $case) {
    if ($case === 'revoked client') {
        $this->client->forceFill(['revoked' => true])->save();
    }

    $overrides = match ($case) {
        'unknown client' => ['client_id' => '0199e1d2-0000-7000-8000-000000000000'],
        'revoked client' => [],
        'another redirect on the same host' => ['redirect_uri' => 'https://claude.ai/api/mcp/other'],
        'another domain' => ['redirect_uri' => 'https://evil.com/api/mcp/auth_callback'],
    };

    oauthConsentCall($method, oauthConsentQuery($this->client, $overrides), $this->organization)
        ->assertStatus(400)
        ->assertExactJson([
            'error' => 'invalid_client',
            'message' => 'The application is not registered or its return address does not match.',
        ]);

    oauthConsentNothingIssued();
})->with(['get', 'post', 'delete'])
    ->with(['unknown client', 'revoked client', 'another redirect on the same host', 'another domain']);

it('rejects scopes other than mcp:use', function (string $method, string $scope) {
    oauthConsentCall($method, oauthConsentQuery($this->client, ['scope' => $scope]), $this->organization)
        ->assertStatus(400)
        ->assertExactJson([
            'error' => 'invalid_scope',
            'message' => 'The application asked for permissions that are not allowed.',
        ]);

    oauthConsentNothingIssued();
})->with(['get', 'post', 'delete'])->with(['*', 'mcp:use admin', 'admin']);

it('accepts the mcp resource of the discovery with or without trailing slash, or no resource', function (?string $resource) {
    $this->getJson('/.well-known/oauth-protected-resource/mcp')->assertJsonPath('resource', url('/mcp'));

    $this->getJson(oauthConsentQuery($this->client, ['resource' => $resource]))->assertOk();
})->with([
    'discovery value' => fn () => url('/mcp'),
    'trailing slash' => fn () => url('/mcp').'/',
    'missing' => [null],
]);

it('rejects a resource other than the mcp server', function (string $method, string $case) {
    $query = match ($case) {
        'another server' => oauthConsentQuery($this->client, ['resource' => 'https://evil.com/mcp']),
        'the api root' => oauthConsentQuery($this->client, ['resource' => url('/')]),
        'another path' => oauthConsentQuery($this->client, ['resource' => url('/mcp/other')]),
        'empty' => oauthConsentQuery($this->client, ['resource' => '']),
        'several' => oauthConsentQuery($this->client, ['resource' => null]).'&resource[]='.urlencode(url('/mcp')),
    };

    oauthConsentCall($method, $query, $this->organization)
        ->assertStatus(400)
        ->assertExactJson(['error' => 'invalid_target', 'message' => 'The authorization request is invalid.']);

    oauthConsentNothingIssued();
})->with(['get', 'post', 'delete'])->with(['another server', 'the api root', 'another path', 'empty', 'several']);

it('rejects an organization of someone else like a missing one', function () {
    $foreign = $this->postJson(oauthConsentQuery($this->client), ['organization_id' => $this->foreign->id])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('organization_id');
    $missing = $this->postJson(oauthConsentQuery($this->client), ['organization_id' => $this->foreign->id + 1000])
        ->assertUnprocessable();

    expect($foreign->json())->toBe($missing->json());
    $this->postJson(oauthConsentQuery($this->client), [])->assertJsonValidationErrors('organization_id');
    oauthConsentNothingIssued();
});

it('requires a session', function (string $method) {
    $this->app['auth']->forgetGuards();
    $this->app['auth']->shouldUse('web');

    oauthConsentCall($method, oauthConsentQuery($this->client), $this->organization)->assertUnauthorized();
})->with(['get', 'post', 'delete']);

it('translates the errors', function () {
    $this->user->forceFill(['locale' => 'es'])->save();

    $this->getJson(oauthConsentQuery($this->client, ['code_challenge_method' => 'plain']))
        ->assertStatus(400)
        ->assertJsonPath('message', 'La solicitud de autorización no es válida.');
});

it('limits the consent endpoints per user and answers in json', function () {
    foreach (range(1, 30) as $i) {
        $this->getJson(oauthConsentQuery($this->client))->assertOk();
    }

    $this->getJson(oauthConsentQuery($this->client))
        ->assertTooManyRequests()
        ->assertJsonStructure(['message']);
});
