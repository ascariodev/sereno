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
]);

it('requires a token', function () {
    authorizeChannel(channelName($this->organization, $this->channel))
        ->assertUnauthorized()
        ->assertJsonPath('message', 'Unauthenticated.');
});
