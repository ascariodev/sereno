<?php

use App\Enums\Role;
use App\Models\McpOauthGrant;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Providers\AppServiceProvider;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Passport;
use Laravel\Passport\Token;
use Laravel\Sanctum\Sanctum;

const MCP_OAUTH_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const MCP_OAUTH_VERIFIER = 'mcp-token-test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz';

function mcpOauthToken(Client $client, User $user, Organization $organization): string
{
    Sanctum::actingAs($user);

    $query = http_build_query([
        'response_type' => 'code',
        'client_id' => $client->getKey(),
        'redirect_uri' => MCP_OAUTH_CALLBACK,
        'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', MCP_OAUTH_VERIFIER, true)), '+/', '-_'), '='),
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
        'redirect_uri' => MCP_OAUTH_CALLBACK,
        'code_verifier' => MCP_OAUTH_VERIFIER,
        'code' => $params['code'],
    ])->assertOk()->json('access_token');

    app('auth')->forgetGuards();
    app(CurrentOrganization::class)->set(null);

    return $token;
}

beforeEach(function () {
    usePassportTestKeys();

    $this->client = app(ClientRepository::class)
        ->createAuthorizationCodeGrantClient('Claude', [MCP_OAUTH_CALLBACK], false);
    $this->user = User::factory()->create();
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->organization->addMember($this->user, [Role::Owner]);
    $this->other->addMember($this->user, [Role::Owner]);

    Project::factory()->for($this->organization)->create(['name' => 'Alpha']);
    Project::factory()->for($this->other)->create(['name' => 'Foreign']);

    $this->listProjects = ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/call', 'params' => ['name' => 'list-projects', 'arguments' => (object) []]];
    $this->headers = fn (string $token): array => [
        'Authorization' => 'Bearer '.$token,
        'Accept' => 'application/json, text/event-stream',
    ];
});

it('lists the projects of the organization chosen in the consent', function () {
    $token = mcpOauthToken($this->client, $this->user, $this->organization);

    $this->postJson('/mcp', $this->listProjects, ($this->headers)($token))
        ->assertOk()
        ->assertJsonPath('id', 1)
        ->assertSee('Alpha')
        ->assertDontSee('Foreign');

    expect(app(CurrentOrganization::class)->id())->toBe($this->organization->id);
});

it('follows the organization of the current grant', function () {
    $token = mcpOauthToken($this->client, $this->user, $this->organization);
    McpOauthGrant::query()->update(['organization_id' => $this->other->id]);

    $this->postJson('/mcp', $this->listProjects, ($this->headers)($token))
        ->assertOk()
        ->assertSee('Foreign')
        ->assertDontSee('Alpha');
});

it('rejects an OAuth token without a grant', function () {
    $token = mcpOauthToken($this->client, $this->user, $this->organization);
    McpOauthGrant::query()->delete();

    $this->postJson('/mcp', $this->listProjects, ($this->headers)($token))
        ->assertForbidden()
        ->assertExactJson([
            'message' => 'You do not belong to this organization.',
            'code' => 'organization_forbidden',
        ]);
});

it('rejects an OAuth token without the mcp scope', function () {
    Passport::actingAs($this->user, [], 'api', $this->client);
    $grant = new McpOauthGrant;
    $grant->client_id = $this->client->getKey();
    $grant->user_id = $this->user->id;
    $grant->organization_id = $this->organization->id;
    $grant->save();

    $this->postJson('/mcp', $this->listProjects, ['Accept' => 'application/json, text/event-stream'])
        ->assertForbidden()
        ->assertExactJson([
            'message' => 'The MCP server only accepts access tokens.',
            'code' => 'access_token_required',
        ]);
});

it('rejects the OAuth token of a former member', function () {
    $token = mcpOauthToken($this->client, $this->user, $this->organization);
    $this->organization->users()->detach($this->user->id);
    app(CurrentOrganization::class)->set($this->other);

    $this->postJson('/mcp', $this->listProjects, ($this->headers)($token))
        ->assertForbidden()
        ->assertExactJson([
            'message' => 'You do not belong to this organization.',
            'code' => 'organization_forbidden',
        ]);

    expect(app(CurrentOrganization::class)->id())->toBeNull();
});

it('answers in the locale of the OAuth token user', function () {
    $token = mcpOauthToken($this->client, $this->user, $this->organization);
    $this->user->forceFill(['locale' => 'es'])->save();
    McpOauthGrant::query()->delete();

    $this->postJson('/mcp', $this->listProjects, [...($this->headers)($token), 'Accept-Language' => 'en'])
        ->assertForbidden()
        ->assertHeader('Content-Language', 'es')
        ->assertJsonPath('message', 'No pertenece a esta organización.');
});

it('rejects a revoked OAuth token with the resource metadata', function () {
    $token = mcpOauthToken($this->client, $this->user, $this->organization);
    Token::query()->update(['revoked' => true]);

    $this->postJson('/mcp', $this->listProjects, ($this->headers)($token))
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.'])
        ->assertHeader('WWW-Authenticate', 'Bearer realm="mcp", resource_metadata="'.url('/.well-known/oauth-protected-resource/mcp').'"');
});

it('throttles each OAuth token on its own', function () {
    $token = mcpOauthToken($this->client, $this->user, $this->organization);
    $key = 'mcp-oauth:'.Token::query()->sole()->getKey();
    $other = mcpOauthToken($this->client, $this->user, $this->organization);

    foreach (range(1, AppServiceProvider::MCP_REQUESTS_PER_MINUTE) as $ignored) {
        RateLimiter::hit(md5('mcp'.$key));
    }

    $this->postJson('/mcp', $this->listProjects, ($this->headers)($token))
        ->assertTooManyRequests();

    $this->app['auth']->forgetGuards();

    $this->postJson('/mcp', $this->listProjects, ($this->headers)($other))
        ->assertOk();
});
