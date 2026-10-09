<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
});

function threadMessageIn(Channel $channel, ?int $parentId = null, string $body = 'text'): int
{
    return DB::table('messages')->insertGetId([
        'organization_id' => $channel->organization_id,
        'channel_id' => $channel->id,
        'kind' => 'user',
        'body' => $body,
        'parent_id' => $parentId,
    ]);
}

function listRepliesAs(User $user, Organization $organization, Channel $channel, int|string $root, string $query = '')
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->getJson("/api/channels/{$channel->id}/messages/{$root}/replies{$query}");
}

it('lists the replies of a root newest first with the message shape and cursor pagination', function () {
    $root = threadMessageIn($this->channel);
    $other = threadMessageIn($this->channel);
    $ids = collect(range(1, 3))->map(fn ($i) => threadMessageIn($this->channel, $root, "r{$i}"));
    $foreign = threadMessageIn($this->channel, $other, 'elsewhere');

    $page = listRepliesAs($this->member, $this->organization, $this->channel, $root, '?per_page=2')
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $ids[2])
        ->assertJsonPath('data.1.id', $ids[1])
        ->assertJsonMissing(['id' => $foreign])
        ->assertJsonPath('data.0.parent_id', $root)
        ->assertJsonStructure(['data' => [['id', 'parent_id', 'replies_count', 'last_reply_at']], 'links', 'meta' => ['next_cursor']]);

    $cursor = $page->json('meta.next_cursor');
    expect($cursor)->not->toBeNull();

    listRepliesAs($this->member, $this->organization, $this->channel, $root, '?per_page=2&cursor='.urlencode($cursor))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $ids[0])
        ->assertJsonMissing(['id' => $foreign])
        ->assertJsonPath('meta.next_cursor', null);
});

it('validates cursor and per_page like the main list', function () {
    $root = threadMessageIn($this->channel);

    listRepliesAs($this->member, $this->organization, $this->channel, $root, '?cursor=garbage')
        ->assertUnprocessable()->assertJsonValidationErrors('cursor');
    listRepliesAs($this->member, $this->organization, $this->channel, $root, '?per_page=101')
        ->assertUnprocessable()->assertJsonValidationErrors('per_page');
});

it('returns 404 when the message is a reply, from another channel or missing', function () {
    $root = threadMessageIn($this->channel);
    $reply = threadMessageIn($this->channel, $root);
    $otherChannel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $inOtherChannel = threadMessageIn($otherChannel);

    listRepliesAs($this->member, $this->organization, $this->channel, $reply)->assertNotFound();
    listRepliesAs($this->member, $this->organization, $this->channel, $inOtherChannel)->assertNotFound();
    listRepliesAs($this->member, $this->organization, $this->channel, 999999)->assertNotFound();
    listRepliesAs($this->member, $this->organization, $this->channel, 'abc')->assertNotFound();
});

it('isolates organizations and requires authentication', function () {
    $root = threadMessageIn($this->channel);
    threadMessageIn($this->channel, $root);
    $foreign = Channel::factory()->for(Project::factory()->for($this->other))->create();
    $foreignRoot = threadMessageIn($foreign);

    listRepliesAs($this->outsider, $this->other, $this->channel, $root)->assertNotFound();
    listRepliesAs($this->outsider, $this->organization, $this->channel, $root)->assertForbidden();
    listRepliesAs($this->member, $this->organization, $foreign, $foreignRoot)->assertNotFound();
    listRepliesAs($this->member, $this->organization, $this->channel, $foreignRoot)->assertNotFound();

    app('auth')->forgetGuards();
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->getJson("/api/channels/{$this->channel->id}/messages/{$root}/replies")
        ->assertUnauthorized();
});

it('reads the replies of an archived channel as a plain member', function () {
    $root = threadMessageIn($this->channel);
    threadMessageIn($this->channel, $root);
    $this->channel->update(['archived_at' => now()]);

    listRepliesAs($this->member, $this->organization, $this->channel, $root)
        ->assertOk()
        ->assertJsonCount(1, 'data');
});
