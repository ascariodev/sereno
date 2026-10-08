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
