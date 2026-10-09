<?php

use App\Enums\Role;
use App\Events\MentionCreated;
use App\Events\MessageCreated;
use App\Models\Channel;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    RateLimiter::clear('channel-messages');
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->author = User::factory()->create(['name' => 'Author']);
    $this->ana = User::factory()->create(['name' => 'Ana']);
    $this->bob = User::factory()->create(['name' => 'Bob']);
    foreach ([$this->author, $this->ana, $this->bob] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->foreign = User::factory()->create();
    $this->other->addMember($this->foreign, [Role::Member]);
    $this->nobody = User::factory()->create();
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
});

function mentionPost(object $test, string $body, ?int $parentId = null)
{
    Sanctum::actingAs($test->author);

    return test()->withHeader('X-Organization-Id', (string) $test->organization->id)
        ->postJson("/api/channels/{$test->channel->id}/messages", array_filter(
            ['body' => $body, 'parent_id' => $parentId],
            fn ($v) => $v !== null,
        ));
}

function mentionedIds(int $messageId): array
{
    return DB::table('message_mentions')->where('message_id', $messageId)->orderBy('user_id')->pluck('user_id')->all();
}

it('saves the mentions of members in a message and returns them', function () {
    $response = mentionPost($this, "hi <@{$this->ana->id}> and <@{$this->bob->id}>")->assertCreated()
        ->assertJsonPath('data.mentions', [
            ['id' => $this->ana->id, 'name' => 'Ana'],
            ['id' => $this->bob->id, 'name' => 'Bob'],
        ]);

    expect(mentionedIds($response->json('data.id')))->toBe([$this->ana->id, $this->bob->id])
        ->and(DB::table('message_mentions')->value('organization_id'))->toBe($this->organization->id);
});

it('saves the mentions of a reply', function () {
    $root = mentionPost($this, 'root')->json('data.id');

    $reply = mentionPost($this, "ping <@{$this->ana->id}>", $root)->assertCreated()
        ->assertJsonPath('data.mentions.0.id', $this->ana->id);

    expect(mentionedIds($reply->json('data.id')))->toBe([$this->ana->id])
        ->and(mentionedIds($root))->toBe([]);
});

it('ignores the author, repeated tokens, non members, other organizations and unknown ids', function () {
    $body = "<@{$this->author->id}> <@{$this->ana->id}> <@{$this->ana->id}> <@{$this->nobody->id}> "
        ."<@{$this->foreign->id}> <@999999999>";

    $id = mentionPost($this, $body)->assertCreated()
        ->assertJsonCount(1, 'data.mentions')
        ->json('data.id');

    expect(mentionedIds($id))->toBe([$this->ana->id]);
});

it('ignores malformed tokens', function () {
    $ana = $this->ana->id;
    $bodies = [
        "<@0{$ana}>",
        "<@ {$ana}>",
        "<@{$ana}",
        "@{$ana}",
        "<@+{$ana}>",
        "<@{$ana}x>",
        "<@-{$ana}>",
        '<@99999999999999999999>',
        "< @{$ana}>",
    ];

    foreach ($bodies as $body) {
        $id = mentionPost($this, $body)->assertCreated()->assertJsonPath('data.mentions', [])->json('data.id');
        expect(mentionedIds($id))->toBe([], $body);
    }
});

it('saves no mentions when the message is rejected', function () {
    $before = DB::table('message_mentions')->count();

    mentionPost($this, str_repeat('x', 4001)." <@{$this->ana->id}>")->assertUnprocessable();

    expect(DB::table('message_mentions')->count())->toBe($before);
});

it('does not create mentions for system messages', function () {
    $id = DB::table('messages')->insertGetId([
        'organization_id' => $this->organization->id,
        'channel_id' => $this->channel->id,
        'kind' => 'system',
        'payload' => '{"type":"log.new_group"}',
    ]);

    expect(mentionedIds($id))->toBe([]);
});

it('lists mentions in the channel and replies without an N+1', function () {
    $root = mentionPost($this, "r <@{$this->ana->id}>")->json('data.id');
    foreach (range(1, 4) as $i) {
        mentionPost($this, "m{$i} <@{$this->ana->id}> <@{$this->bob->id}>");
        mentionPost($this, "p{$i} <@{$this->bob->id}>", $root);
    }
    $headers = ['X-Organization-Id' => (string) $this->organization->id];

    DB::enableQueryLog();
    $index = $this->withHeaders($headers)->getJson("/api/channels/{$this->channel->id}/messages")->assertOk();
    $replies = $this->withHeaders($headers)->getJson("/api/channels/{$this->channel->id}/messages/{$root}/replies")->assertOk();
    $queries = collect(DB::getQueryLog())->pluck('query')->filter(fn ($q) => str_contains($q, 'message_mentions'));
    DB::disableQueryLog();

    expect($queries)->toHaveCount(2)
        ->and($index->json('data.0.mentions'))->toHaveCount(2)
        ->and($replies->json('data.0.mentions'))->toBe([['id' => $this->bob->id, 'name' => 'Bob']]);
});

it('carries the mentions in the message.created payload', function () {
    Event::fake([MessageCreated::class]);

    mentionPost($this, "hey <@{$this->bob->id}>")->assertCreated();

    Event::assertDispatched(MessageCreated::class, fn ($e) => $e->message['mentions'] === [['id' => $this->bob->id, 'name' => 'Bob']]);
});

it('caps the mentions per message at 50 by default', function () {
    expect(config('chat.mentions.max_per_message'))->toBe(50);
});

it('keeps only the first valid mentions up to the cap, in order of appearance', function () {
    Event::fake([MentionCreated::class]);
    config(['chat.mentions.max_per_message' => 2]);
    $carl = User::factory()->create(['name' => 'Carl']);
    $this->organization->addMember($carl, [Role::Member]);
    $body = "<@{$this->author->id}> <@{$carl->id}> <@{$this->nobody->id}> <@{$carl->id}> "
        ."<@{$this->foreign->id}> <@{$this->bob->id}> <@{$this->ana->id}>";

    DB::enableQueryLog();
    $response = mentionPost($this, $body)->assertCreated();
    $inserts = collect(DB::getQueryLog())->pluck('query')
        ->filter(fn ($q) => str_starts_with($q, 'insert into "message_mentions"'));
    DB::disableQueryLog();

    $response->assertJsonPath('data.body', $body)
        ->assertJsonPath('data.mentions', [
            ['id' => $this->bob->id, 'name' => 'Bob'],
            ['id' => $carl->id, 'name' => 'Carl'],
        ]);
    expect(mentionedIds($response->json('data.id')))->toBe([$this->bob->id, $carl->id])
        ->and($inserts)->toHaveCount(1)
        ->and(DB::table('messages')->where('id', $response->json('data.id'))->value('body'))->toBe($body);
    Event::assertDispatchedTimes(MentionCreated::class, 2);
    Event::assertNotDispatched(MentionCreated::class, fn ($e) => $e->userId === $this->ana->id);
});
