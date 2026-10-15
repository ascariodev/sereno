<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->user = User::factory()->create();
    $this->organization->addMember($this->user, [Role::Member]);
});

function accessTokenHeaders(User $user, Organization $organization): array
{
    return [
        'Authorization' => 'Bearer '.$user->createAccessToken($organization, 'Claude Code')->plainTextToken,
        'X-Organization-Id' => (string) $organization->id,
    ];
}

function sessionTokenHeaders(User $user, Organization $organization): array
{
    return [
        'Authorization' => 'Bearer '.$user->createToken('browser')->plainTextToken,
        'X-Organization-Id' => (string) $organization->id,
    ];
}

it('rejects an access token on the REST API', function (string $method, string $uri) {
    $this->json($method, $uri, [], accessTokenHeaders($this->user, $this->organization))
        ->assertForbidden()
        ->assertExactJson([
            'message' => 'Access tokens only work with the MCP server.',
            'code' => 'access_token_forbidden',
        ]);
})->with([
    'me' => ['GET', '/api/me'],
    'organizations' => ['GET', '/api/organizations'],
    'projects' => ['GET', '/api/projects'],
    'access tokens list' => ['GET', '/api/access-tokens'],
    'access tokens create' => ['POST', '/api/access-tokens'],
    'invitations' => ['GET', '/api/invitations'],
    'logout' => ['POST', '/api/auth/logout'],
]);

it('rejects an access token before checking the organization header', function () {
    $headers = accessTokenHeaders($this->user, $this->organization);
    unset($headers['X-Organization-Id']);

    $this->getJson('/api/projects', $headers)
        ->assertForbidden()
        ->assertJsonPath('code', 'access_token_forbidden');
});

it('translates the rejection', function () {
    $this->getJson('/api/me', [...accessTokenHeaders($this->user, $this->organization), 'Accept-Language' => 'es'])
        ->assertForbidden()
        ->assertJsonPath('message', 'Los tokens de acceso solo funcionan con el servidor MCP.');
});

it('does not revoke the access token when it calls logout', function () {
    $this->postJson('/api/auth/logout', [], accessTokenHeaders($this->user, $this->organization))->assertForbidden();

    expect($this->user->tokens()->count())->toBe(1);
});

it('accepts a session token', function () {
    $headers = sessionTokenHeaders($this->user, $this->organization);

    $this->getJson('/api/me', $headers)->assertOk();
    $this->getJson('/api/projects', $headers)->assertOk();
    $this->getJson('/api/access-tokens', $headers)->assertOk();
});

it('accepts a session token after an access token of another user', function () {
    $other = User::factory()->create();
    $this->organization->addMember($other, [Role::Member]);

    $this->getJson('/api/me', accessTokenHeaders($other, $this->organization))->assertForbidden();
    $this->app['auth']->forgetGuards();

    $this->getJson('/api/me', sessionTokenHeaders($this->user, $this->organization))
        ->assertOk()
        ->assertJsonPath('data.id', $this->user->id);
});

it('accepts Sanctum::actingAs', function () {
    Sanctum::actingAs($this->user);

    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->getJson('/api/projects')
        ->assertOk();
});

it('leaves public routes alone', function () {
    $this->getJson('/api/auth/registration')->assertOk();
});

describe('broadcasting', function () {
    beforeEach(function () {
        config([
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.key' => 'test-key',
            'broadcasting.connections.reverb.secret' => 'test-secret',
            'broadcasting.connections.reverb.app_id' => 'test-app',
        ]);
        require base_path('routes/channels.php');

        $project = Project::factory()->for($this->organization)->create();
        $channel = Channel::factory()->for($project)->create();
        assignMembersToAllProjects();
        $this->channelName = "private-organizations.{$this->organization->id}.channels.{$channel->id}";
    });

    it('rejects an access token', function () {
        $this->postJson('/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => $this->channelName], accessTokenHeaders($this->user, $this->organization))
            ->assertForbidden()
            ->assertJsonPath('code', 'access_token_forbidden');
    });

    it('accepts a session token', function () {
        $this->postJson('/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => $this->channelName], sessionTokenHeaders($this->user, $this->organization))
            ->assertOk()
            ->assertJsonStructure(['auth']);
    });
});
