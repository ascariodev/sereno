<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\User;
use App\Providers\AppServiceProvider;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->user = User::factory()->create();
    $this->organization->addMember($this->user, [Role::Member]);

    $this->initialize = [
        'jsonrpc' => '2.0',
        'id' => 1,
        'method' => 'initialize',
        'params' => [
            'protocolVersion' => '2025-11-25',
            'capabilities' => (object) [],
            'clientInfo' => ['name' => 'pest', 'version' => '1.0.0'],
        ],
    ];

    $this->bearer = fn (string $token): array => [
        'Authorization' => 'Bearer '.$token,
        'Accept' => 'application/json, text/event-stream',
    ];
});

it('requires authentication', function () {
    $this->postJson('/mcp', $this->initialize, ['Accept' => 'application/json, text/event-stream'])
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.'])
        ->assertHeader('WWW-Authenticate', 'Bearer realm="mcp", resource_metadata="'.url('/.well-known/oauth-protected-resource/mcp').'"');
});

it('rejects a session token', function () {
    $token = $this->user->createToken('browser')->plainTextToken;

    $this->postJson('/mcp', $this->initialize, ($this->bearer)($token))
        ->assertForbidden()
        ->assertExactJson([
            'message' => 'The MCP server only accepts access tokens.',
            'code' => 'access_token_required',
        ]);
});

it('rejects a Sanctum mock without a real access token', function () {
    Sanctum::actingAs($this->user, ['mcp']);

    $this->postJson('/mcp', $this->initialize)
        ->assertForbidden()
        ->assertJsonPath('code', 'access_token_required');
});

it('translates the rejection', function () {
    $token = $this->user->createToken('browser')->plainTextToken;

    $this->postJson('/mcp', $this->initialize, [...($this->bearer)($token), 'Accept-Language' => 'es'])
        ->assertForbidden()
        ->assertJsonPath('message', 'El servidor MCP solo acepta tokens de acceso.');
});

it('rejects the access token of a former member', function () {
    $token = $this->user->createAccessToken($this->organization, 'Claude Code')->plainTextToken;
    $this->organization->users()->detach($this->user->id);
    app(CurrentOrganization::class)->set(Organization::factory()->create());

    $this->postJson('/mcp', $this->initialize, ($this->bearer)($token))
        ->assertForbidden()
        ->assertExactJson([
            'message' => 'You do not belong to this organization.',
            'code' => 'organization_forbidden',
        ]);

    expect(app(CurrentOrganization::class)->id())->toBeNull();
});

it('ignores the organization header and keeps the one of the token', function () {
    $other = Organization::factory()->create();
    $other->addMember($this->user, [Role::Member]);
    $token = $this->user->createAccessToken($this->organization, 'Claude Code')->plainTextToken;

    $this->postJson('/mcp', $this->initialize, [...($this->bearer)($token), 'X-Organization-Id' => (string) $other->id])
        ->assertOk();

    expect(app(CurrentOrganization::class)->id())->toBe($this->organization->id);
});

it('rejects an expired access token', function () {
    $token = $this->user->createAccessToken($this->organization, 'Claude Code', now()->subMinute())->plainTextToken;

    $this->postJson('/mcp', $this->initialize, ($this->bearer)($token))
        ->assertUnauthorized();
});

it('completes initialize with a valid access token', function () {
    $token = $this->user->createAccessToken($this->organization, 'Claude Code')->plainTextToken;

    $this->postJson('/mcp', $this->initialize, ($this->bearer)($token))
        ->assertOk()
        ->assertJsonPath('id', 1)
        ->assertJsonPath('result.protocolVersion', '2025-11-25')
        ->assertJsonPath('result.serverInfo.name', 'Sereno')
        ->assertJsonPath('result.serverInfo.version', '1.0.0');

    expect(app(CurrentOrganization::class)->id())->toBe($this->organization->id);
});

it('lists the registered tools', function () {
    $token = $this->user->createAccessToken($this->organization, 'Claude Code')->plainTextToken;

    $this->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/list'], ($this->bearer)($token))
        ->assertOk()
        ->assertJsonPath('id', 2)
        ->assertJsonCount(11, 'result.tools')
        ->assertJsonPath('result.tools.0.name', 'list-projects')
        ->assertJsonPath('result.tools.1.name', 'list-tasks')
        ->assertJsonPath('result.tools.2.name', 'get-task')
        ->assertJsonPath('result.tools.3.name', 'list-channel-messages')
        ->assertJsonPath('result.tools.4.name', 'list-log-groups')
        ->assertJsonPath('result.tools.5.name', 'get-log-group')
        ->assertJsonPath('result.tools.6.name', 'comment-on-task')
        ->assertJsonPath('result.tools.7.name', 'create-task')
        ->assertJsonPath('result.tools.8.name', 'move-task')
        ->assertJsonPath('result.tools.9.name', 'update-task')
        ->assertJsonPath('result.tools.10.name', 'list-project-members');
});

it('throttles each access token on its own', function () {
    $token = $this->user->createAccessToken($this->organization, 'Claude Code');
    $other = $this->user->createAccessToken($this->organization, 'Claude Code 2')->plainTextToken;
    $key = 'mcp-token:'.$token->accessToken->getKey();

    foreach (range(1, AppServiceProvider::MCP_REQUESTS_PER_MINUTE) as $ignored) {
        RateLimiter::hit(md5('mcp'.$key));
    }

    $this->postJson('/mcp', $this->initialize, ($this->bearer)($token->plainTextToken))
        ->assertTooManyRequests();

    $this->app['auth']->forgetGuards();

    $this->postJson('/mcp', $this->initialize, ($this->bearer)($other))
        ->assertOk();
});
