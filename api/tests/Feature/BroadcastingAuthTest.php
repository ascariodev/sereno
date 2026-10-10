<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    // The null driver authorizes everything, so these tests run against a real broadcaster.
    config([
        'broadcasting.default' => 'reverb',
        'broadcasting.connections.reverb.key' => 'test-key',
        'broadcasting.connections.reverb.secret' => 'test-secret',
        'broadcasting.connections.reverb.app_id' => 'test-app',
    ]);
    require base_path('routes/channels.php');

    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();

    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);

    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);

    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
});

function authorizeChannel(string $channelName)
{
    return test()->post('/broadcasting/auth', [
        'socket_id' => '1234.5678',
        'channel_name' => 'private-'.$channelName,
    ]);
}

function channelName(Organization $organization, Channel $channel): string
{
    return "organizations.{$organization->id}.channels.{$channel->id}";
}

it('authorizes a member of the organization without X-Organization-Id', function () {
    Sanctum::actingAs($this->member);

    authorizeChannel(channelName($this->organization, $this->channel))
        ->assertOk()
        ->assertJsonStructure(['auth']);
});

it('rejects a user who is not a member of the organization', function () {
    Sanctum::actingAs($this->outsider);

    authorizeChannel(channelName($this->organization, $this->channel))->assertForbidden();
});

it('rejects a channel that belongs to another organization', function () {
    $foreign = Channel::factory()->for(Project::factory()->for($this->other))->create();
    $this->other->addMember($this->member, [Role::Member]);
    Sanctum::actingAs($this->member);

    authorizeChannel(channelName($this->organization, $foreign))->assertForbidden();
});

it('rejects a nonexistent channel of the member organization', function () {
    Sanctum::actingAs($this->member);

    authorizeChannel("organizations.{$this->organization->id}.channels.".($this->channel->id + 1000))->assertForbidden();
});

it('rejects malformed channel parameters', function () {
    Sanctum::actingAs($this->member);

    authorizeChannel("organizations.{$this->organization->id}.channels.abc")->assertForbidden();
});

it('rejects ids that do not fit in a bigint', function (string $channelName) {
    Sanctum::actingAs($this->member);

    authorizeChannel(str_replace(
        ['{organization}', '{channel}'],
        [$this->organization->id, $this->channel->id],
        $channelName,
    ))->assertForbidden();
})->with([
    'organization' => 'organizations.99999999999999999999.channels.{channel}',
    'channel' => 'organizations.{organization}.channels.99999999999999999999',
    'zero' => 'organizations.{organization}.channels.0',
    'leading zeros' => 'organizations.{organization}.channels.0{channel}',
    'bigint overflow' => 'organizations.{organization}.channels.9223372036854775808',
]);

it('requires a token', function () {
    authorizeChannel(channelName($this->organization, $this->channel))
        ->assertUnauthorized()
        ->assertJsonPath('message', 'Unauthenticated.');
});

it('translates the 401 on /broadcasting/auth with Accept-Language', function () {
    $this->post('/broadcasting/auth', [
        'socket_id' => '1234.5678',
        'channel_name' => 'private-'.channelName($this->organization, $this->channel),
    ], ['Accept-Language' => 'es'])
        ->assertUnauthorized()
        ->assertHeader('Content-Language', 'es')
        ->assertExactJson(['message' => __('Unauthenticated.', [], 'es')]);

    expect(__('Unauthenticated.', [], 'es'))->not->toBe(__('Unauthenticated.', [], 'en'));
});

it('uses the user locale on a 403 from /broadcasting/auth without Accept-Language', function () {
    $this->outsider->update(['locale' => 'es']);
    $token = $this->outsider->createToken('test')->plainTextToken;

    $this->withToken($token)
        ->post('/broadcasting/auth', [
            'socket_id' => '1234.5678',
            'channel_name' => 'private-'.channelName($this->organization, $this->channel),
        ])
        ->assertForbidden()
        ->assertHeader('Content-Language', 'es');
});

it('authorizes the user on their own channel without X-Organization-Id', function () {
    Sanctum::actingAs($this->member);

    authorizeChannel("users.{$this->member->id}")
        ->assertOk()
        ->assertJsonStructure(['auth']);
});

it('rejects a user on the channel of another user', function () {
    Sanctum::actingAs($this->member);

    authorizeChannel("users.{$this->outsider->id}")->assertForbidden();
});

it('rejects malformed user channel ids', function (string $suffix) {
    Sanctum::actingAs($this->member);

    authorizeChannel('users.'.str_replace('{id}', (string) $this->member->id, $suffix))->assertForbidden();
})->with([
    'letters' => 'abc',
    'zero' => '0',
    'leading zero' => '0{id}',
    'bigint overflow' => '9223372036854775808',
    'huge' => '99999999999999999999',
]);

it('requires a token on the user channel', function () {
    authorizeChannel("users.{$this->member->id}")
        ->assertUnauthorized()
        ->assertJsonPath('message', 'Unauthenticated.');
});

function authorizePresence(string $channelName)
{
    return test()->post('/broadcasting/auth', [
        'socket_id' => '1234.5678',
        'channel_name' => 'presence-'.$channelName,
    ]);
}

it('authorizes the user on their own session presence channel', function () {
    Sanctum::actingAs($this->member);

    $response = authorizePresence("sessions.{$this->member->id}")
        ->assertOk()
        ->assertJsonStructure(['auth', 'channel_data']);

    expect(json_decode($response->json('channel_data'), true))
        ->toBe(['user_id' => (string) $this->member->id, 'user_info' => ['id' => $this->member->id]]);
});

it('rejects a user on the session channel of another user', function () {
    Sanctum::actingAs($this->member);

    authorizePresence("sessions.{$this->outsider->id}")->assertForbidden();
});

it('rejects malformed session channel ids', function (string $suffix) {
    Sanctum::actingAs($this->member);

    authorizePresence('sessions.'.str_replace('{id}', (string) $this->member->id, $suffix))->assertForbidden();
})->with([
    'letters' => 'abc',
    'zero' => '0',
    'leading zero' => '0{id}',
    'bigint overflow' => '9223372036854775808',
    'huge' => '99999999999999999999',
]);

it('requires a token on the session channel', function () {
    authorizePresence("sessions.{$this->member->id}")
        ->assertUnauthorized()
        ->assertJsonPath('message', 'Unauthenticated.');
});

function projectChannelName(Organization $organization, Project $project): string
{
    return "organizations.{$organization->id}.projects.{$project->id}";
}

it('authorizes a member on the project channel without X-Organization-Id', function () {
    Sanctum::actingAs($this->member);

    authorizeChannel(projectChannelName($this->organization, Project::withoutGlobalScopes()->findOrFail($this->channel->project_id)))
        ->assertOk()
        ->assertJsonStructure(['auth']);
});

it('rejects a non member on the project channel', function () {
    Sanctum::actingAs($this->outsider);

    authorizeChannel(projectChannelName($this->organization, Project::withoutGlobalScopes()->findOrFail($this->channel->project_id)))->assertForbidden();
});

it('rejects a project of another organization on the project channel', function () {
    $foreign = Project::factory()->for($this->other)->create();
    $this->other->addMember($this->member, [Role::Member]);
    Sanctum::actingAs($this->member);

    authorizeChannel(projectChannelName($this->organization, $foreign))->assertForbidden();
    authorizeChannel(projectChannelName($this->other, $foreign))->assertOk();
});

it('rejects a nonexistent project on the project channel', function () {
    Sanctum::actingAs($this->member);

    authorizeChannel("organizations.{$this->organization->id}.projects.".($this->channel->project_id + 1000))->assertForbidden();
});

it('rejects malformed project channel parameters', function (string $channelName) {
    Sanctum::actingAs($this->member);

    authorizeChannel(str_replace(
        ['{organization}', '{project}'],
        [$this->organization->id, $this->channel->project_id],
        $channelName,
    ))->assertForbidden();
})->with([
    'letters' => 'organizations.{organization}.projects.abc',
    'organization overflow' => 'organizations.99999999999999999999.projects.{project}',
    'zero' => 'organizations.{organization}.projects.0',
    'leading zero project' => 'organizations.{organization}.projects.0{project}',
    'leading zero organization' => 'organizations.0{organization}.projects.{project}',
    'bigint overflow' => 'organizations.{organization}.projects.9223372036854775808',
]);

it('requires a token on the project channel', function () {
    authorizeChannel(projectChannelName($this->organization, Project::withoutGlobalScopes()->findOrFail($this->channel->project_id)))
        ->assertUnauthorized()
        ->assertJsonPath('message', 'Unauthenticated.');
});
