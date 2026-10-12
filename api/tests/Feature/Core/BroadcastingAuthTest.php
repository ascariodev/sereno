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

    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create();
    assignMembersToAllProjects();
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
    assignMembersToAllProjects();
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

function authorizeSessionPresence(string $channelName)
{
    return test()->post('/broadcasting/auth', [
        'socket_id' => '1234.5678',
        'channel_name' => 'presence-'.$channelName,
    ]);
}

it('authorizes the user on their own session presence channel', function () {
    Sanctum::actingAs($this->member);

    $response = authorizeSessionPresence("sessions.{$this->member->id}")
        ->assertOk()
        ->assertJsonStructure(['auth', 'channel_data']);

    expect(json_decode($response->json('channel_data'), true))
        ->toBe(['user_id' => (string) $this->member->id, 'user_info' => ['id' => $this->member->id]]);
});

it('rejects a user on the session channel of another user', function () {
    Sanctum::actingAs($this->member);

    authorizeSessionPresence("sessions.{$this->outsider->id}")->assertForbidden();
});

it('rejects malformed session channel ids', function (string $suffix) {
    Sanctum::actingAs($this->member);

    authorizeSessionPresence('sessions.'.str_replace('{id}', (string) $this->member->id, $suffix))->assertForbidden();
})->with([
    'letters' => 'abc',
    'zero' => '0',
    'leading zero' => '0{id}',
    'bigint overflow' => '9223372036854775808',
    'huge' => '99999999999999999999',
]);

it('requires a token on the session channel', function () {
    authorizeSessionPresence("sessions.{$this->member->id}")
        ->assertUnauthorized()
        ->assertJsonPath('message', 'Unauthenticated.');
});

function projectChannelName(Organization $organization, Project $project): string
{
    return "organizations.{$organization->id}.projects.{$project->id}";
}

it('authorizes a member on the project channel without X-Organization-Id', function () {
    Sanctum::actingAs($this->member);

    authorizeChannel(projectChannelName($this->organization, $this->project))
        ->assertOk()
        ->assertJsonStructure(['auth']);
});

it('rejects a non member on the project channel', function () {
    Sanctum::actingAs($this->outsider);

    authorizeChannel(projectChannelName($this->organization, $this->project))->assertForbidden();
});

it('rejects a project of another organization on the project channel', function () {
    $foreign = Project::factory()->for($this->other)->create();
    $this->other->addMember($this->member, [Role::Member]);
    assignMembersToAllProjects();
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
    authorizeChannel(projectChannelName($this->organization, $this->project))
        ->assertUnauthorized()
        ->assertJsonPath('message', 'Unauthenticated.');
});

it('rejects a member without access to the project on its channel and project channel', function () {
    $unassigned = User::factory()->create();
    $this->organization->addMember($unassigned, [Role::Member]);
    Sanctum::actingAs($unassigned);

    authorizeChannel(channelName($this->organization, $this->channel))->assertForbidden();
    authorizeChannel(projectChannelName($this->organization, $this->project))->assertForbidden();
});

it('authorizes a member once assigned to the project', function () {
    $newcomer = User::factory()->create();
    $this->organization->addMember($newcomer, [Role::Member]);
    $project = $this->project;
    $project->addMember($newcomer);
    Sanctum::actingAs($newcomer);

    authorizeChannel(channelName($this->organization, $this->channel))->assertOk();
    authorizeChannel(projectChannelName($this->organization, $project))->assertOk();
});

it('authorizes owner and admin without project assignment', function (Role $role) {
    $user = User::factory()->create();
    $this->organization->addMember($user, [$role]);
    Sanctum::actingAs($user);

    authorizeChannel(channelName($this->organization, $this->channel))->assertOk();
    authorizeChannel(projectChannelName($this->organization, $this->project))->assertOk();
})->with([Role::Owner, Role::Admin]);

it('authorizes any member of the organization on a channel without project', function () {
    $unassigned = User::factory()->create();
    $this->organization->addMember($unassigned, [Role::Member]);
    $general = Channel::factory()->create(['organization_id' => $this->organization->id, 'project_id' => null]);
    Sanctum::actingAs($unassigned);

    authorizeChannel(channelName($this->organization, $general))->assertOk();
});

it('rejects owner and admin of one organization on a channel and project of another', function (Role $role) {
    $user = User::factory()->create();
    $this->organization->addMember($user, [$role]);
    $foreignProject = Project::factory()->for($this->other)->create();
    $foreignChannel = Channel::factory()->for($foreignProject)->create();
    Sanctum::actingAs($user);

    authorizeChannel(channelName($this->organization, $foreignChannel))->assertForbidden();
    authorizeChannel(channelName($this->other, $foreignChannel))->assertForbidden();
    authorizeChannel(projectChannelName($this->organization, $foreignProject))->assertForbidden();
    authorizeChannel(projectChannelName($this->other, $foreignProject))->assertForbidden();
})->with([Role::Owner, Role::Admin]);

it('authorizes owners and admins, but not members or outsiders, on the organization members channel', function () {
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);
    $name = "organizations.{$this->organization->id}.members";

    Sanctum::actingAs($admin);
    authorizeChannel($name)->assertOk();

    Sanctum::actingAs($this->member);
    authorizeChannel($name)->assertForbidden();

    Sanctum::actingAs($this->outsider);
    authorizeChannel($name)->assertForbidden();
});
