<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();

    $this->users = [];
    foreach (Role::cases() as $role) {
        $user = User::factory()->create();
        $this->organization->addMember($user, [$role]);
        $this->users[$role->value] = $user;
    }

    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create();

    assignMembersToAllProjects();
});

function asChannelReader(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

it('lists non archived channels with their project, readable by every role', function () {
    Channel::factory()->for(Project::factory()->for($this->organization))->archived()->create();
    Channel::factory()->for(Project::factory()->for($this->other))->create();

    foreach (Role::cases() as $role) {
        asChannelReader($this->users[$role->value], $this->organization)
            ->getJson('/api/channels')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $this->channel->id)
            ->assertJsonPath('data.0.name', $this->channel->name)
            ->assertJsonPath('data.0.project.key', $this->project->key)
            ->assertJsonStructure(['data' => [['id', 'project_id', 'name', 'archived_at', 'created_at']]])
            ->assertJsonPath('data.0', [
                'id' => $this->channel->id,
                'project_id' => $this->project->id,
                'name' => $this->channel->name,
                'archived_at' => null,
                'created_at' => $this->channel->created_at->toJSON(),
                'project' => ['id' => $this->project->id, 'name' => $this->project->name, 'key' => $this->project->key],
            ])
            ->assertJsonPath('meta.next_cursor', null);
    }
});

it('paginates channels by name with a cursor', function () {
    foreach (['b', 'c'] as $name) {
        Channel::factory()->for(Project::factory()->for($this->organization))->create(['name' => $name]);
    }
    $this->channel->update(['name' => 'a']);
    $member = $this->users['member'];
    assignMembersToAllProjects();

    $first = asChannelReader($member, $this->organization)->getJson('/api/channels?per_page=2')
        ->assertOk()
        ->assertJsonPath('data.*.name', ['a', 'b'])
        ->assertJsonPath('meta.per_page', 2);
    $cursor = $first->json('meta.next_cursor');
    expect($cursor)->not->toBeNull();

    asChannelReader($member, $this->organization)->getJson("/api/channels?per_page=2&cursor={$cursor}")
        ->assertOk()
        ->assertJsonPath('data.*.name', ['c'])
        ->assertJsonPath('meta.next_cursor', null);

    asChannelReader($member, $this->organization)->getJson('/api/channels?per_page=101')->assertUnprocessable();
    asChannelReader($member, $this->organization)->getJson('/api/channels?cursor=not-a-cursor')
        ->assertUnprocessable()->assertJsonValidationErrors('cursor');
});

it('lists archived channels only with include_archived', function () {
    $archived = Channel::factory()->for(Project::factory()->for($this->organization))->archived()->create();
    Channel::factory()->for(Project::factory()->for($this->other))->archived()->create();
    assignMembersToAllProjects();
    $reader = $this->users['member'];

    asChannelReader($reader, $this->organization)->getJson('/api/channels?include_archived=1')
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonFragment(['id' => $archived->id]);

    asChannelReader($reader, $this->organization)->getJson('/api/channels?include_archived=0')
        ->assertJsonCount(1, 'data');
    asChannelReader($reader, $this->organization)->getJson('/api/channels')
        ->assertJsonCount(1, 'data');
});

it('rejects listing channels for a non member or without a token', function () {
    asChannelReader($this->outsider, $this->organization)->getJson('/api/channels')->assertForbidden();
});

it('requires a token to read channels and messages', function () {
    $this->getJson('/api/channels')->assertUnauthorized();
    $this->getJson("/api/channels/{$this->channel->id}/messages")->assertUnauthorized();
});

it('paginates messages newest first with a cursor', function () {
    $messages = Message::factory()->for($this->channel)->count(5)->create()->values();
    Message::factory()->for(Channel::factory()->for(Project::factory()->for($this->organization)))->create();

    $first = asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?per_page=2")
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $messages[4]->id)
        ->assertJsonPath('data.1.id', $messages[3]->id)
        ->assertJsonPath('data.0.user.id', $messages[4]->user_id)
        ->assertJsonStructure(['data' => [['id', 'channel_id', 'kind', 'body', 'payload', 'log_group_id', 'user', 'created_at']], 'meta' => ['next_cursor', 'per_page']]);

    $cursor = $first->json('meta.next_cursor');
    expect($cursor)->not->toBeNull();

    $second = asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?per_page=2&cursor={$cursor}")
        ->assertOk()
        ->assertJsonPath('data.0.id', $messages[2]->id)
        ->assertJsonPath('data.1.id', $messages[1]->id);

    $cursor = $second->json('meta.next_cursor');

    $last = asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?per_page=2&cursor={$cursor}")
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $messages[0]->id);

    expect($last->json('meta.next_cursor'))->toBeNull();
});

it('rejects a non-string messages cursor with 422', function () {
    asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?cursor[]=x")
        ->assertUnprocessable()->assertJsonValidationErrors('cursor');
});

it('returns system messages with payload and no user', function () {
    $message = Message::factory()->for($this->channel)->system(['type' => 'log.group_opened', 'title' => 'Boom'])->create();

    asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages")
        ->assertOk()
        ->assertJsonPath('data.0.id', $message->id)
        ->assertJsonPath('data.0.kind', 'system')
        ->assertJsonPath('data.0.body', null)
        ->assertJsonPath('data.0.user', null)
        ->assertJsonPath('data.0.payload.title', 'Boom');
});

it('validates per_page', function () {
    asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?per_page=101")
        ->assertUnprocessable()
        ->assertJsonValidationErrors('per_page');
});

it('rejects a malformed cursor', function () {
    Message::factory()->for($this->channel)->create();

    asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?cursor=not-a-cursor")
        ->assertUnprocessable()
        ->assertJsonValidationErrors('cursor');
});

it('rejects a decodable cursor without the id parameter', function () {
    Message::factory()->for($this->channel)->create();
    $cursor = rtrim(strtr(base64_encode(json_encode(['created_at' => 5, '_pointsToNextItems' => true])), '+/', '-_'), '=');

    asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?cursor={$cursor}")
        ->assertUnprocessable()
        ->assertJsonValidationErrors('cursor');
});

it('rejects an encoded cursor whose id is not a positive bigint', function (string $json) {
    Message::factory()->for($this->channel)->create();
    $cursor = rtrim(strtr(base64_encode($json), '+/', '-_'), '=');

    asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?cursor={$cursor}")
        ->assertUnprocessable()
        ->assertJsonValidationErrors('cursor');
})->with([
    'out of bigint' => '{"id":99999999999999999999,"_pointsToNextItems":true}',
    'negative' => '{"id":-5,"_pointsToNextItems":true}',
    'zero' => '{"id":0,"_pointsToNextItems":true}',
    'float' => '{"id":1.5,"_pointsToNextItems":true}',
    'numeric string' => '{"id":"5","_pointsToNextItems":true}',
]);

it('translates the invalid cursor error', function () {
    asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?cursor=not-a-cursor", ['Accept-Language' => 'es'])
        ->assertUnprocessable()
        ->assertJsonPath('errors.cursor.0', 'El cursor no es válido.');
});

it('authorizes before validating the cursor', function () {
    asChannelReader($this->outsider, $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages?cursor=not-a-cursor")
        ->assertForbidden();
});

it('hides messages of a channel from another organization', function () {
    Message::factory()->for($this->channel)->create();

    asChannelReader($this->outsider, $this->other)
        ->getJson("/api/channels/{$this->channel->id}/messages")
        ->assertNotFound();

    asChannelReader($this->outsider, $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages")
        ->assertForbidden();
});

it('reads messages of an archived channel', function () {
    $this->channel->update(['archived_at' => now()]);
    Message::factory()->for($this->channel)->create();

    asChannelReader($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages")
        ->assertOk()
        ->assertJsonCount(1, 'data');
});

function unassignedChannelFor(Organization $organization): Channel
{
    return Channel::factory()->for(Project::factory()->for($organization))->create();
}

it('lists only the channels of the projects a member is assigned to', function () {
    $hidden = unassignedChannelFor($this->organization);

    asChannelReader($this->users['member'], $this->organization)->getJson('/api/channels')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $this->channel->id);

    foreach (['owner', 'admin'] as $role) {
        asChannelReader($this->users[$role], $this->organization)->getJson('/api/channels')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonFragment(['id' => $hidden->id]);
    }
});

it('answers 404 to a member on the messages, replies, posts and uploads of an unassigned channel', function () {
    $hidden = unassignedChannelFor($this->organization);
    $message = Message::factory()->for($hidden)->create();
    $member = $this->users['member'];

    asChannelReader($member, $this->organization)->getJson("/api/channels/{$hidden->id}/messages")->assertNotFound();
    asChannelReader($member, $this->organization)->getJson("/api/channels/{$hidden->id}/messages/{$message->id}/replies")->assertNotFound();
    asChannelReader($member, $this->organization)->postJson("/api/channels/{$hidden->id}/messages", ['body' => 'hi'])->assertNotFound();
    asChannelReader($member, $this->organization)->postJson("/api/channels/{$hidden->id}/attachments")->assertNotFound();

    asChannelReader($this->users['admin'], $this->organization)->getJson("/api/channels/{$hidden->id}/messages")->assertOk();
    expect(Message::withoutGlobalScopes()->where('channel_id', $hidden->id)->count())->toBe(1);
});

it('answers 404 to a member who edits or deletes their own message in an unassigned channel', function () {
    $hidden = unassignedChannelFor($this->organization);
    $member = $this->users['member'];
    $message = Message::factory()->for($hidden)->create([
        'kind' => Message::KIND_USER,
        'user_id' => $member->id,
        'body' => 'mine',
    ]);

    asChannelReader($member, $this->organization)
        ->patchJson("/api/channels/{$hidden->id}/messages/{$message->id}", ['body' => 'changed'])->assertNotFound();
    asChannelReader($member, $this->organization)
        ->deleteJson("/api/channels/{$hidden->id}/messages/{$message->id}")->assertNotFound();

    expect($message->refresh()->body)->toBe('mine')->and($message->deleted_at)->toBeNull();
});
