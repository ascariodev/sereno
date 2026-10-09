<?php

use App\Enums\Role;
use App\Events\MentionCreated;
use App\Events\MessageCreated;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
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
    foreach ([$this->author, $this->ana] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->other->addMember($this->author, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->sibling = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->foreignChannel = Channel::factory()->for(Project::factory()->for($this->other))->create();
});

function pendingAttachment(Channel $channel, User $uploader, ?int $messageId = null, string $name = 'report.pdf'): int
{
    return DB::table('message_attachments')->insertGetId([
        'organization_id' => $channel->organization_id,
        'channel_id' => $channel->id,
        'message_id' => $messageId,
        'uploaded_by' => $uploader->id,
        'disk' => 'local',
        'path' => 'chat/'.fake()->uuid(),
        'original_name' => $name,
        'mime' => 'application/pdf',
        'size' => 1234,
    ]);
}

function attachPost(object $test, array $data, ?string $locale = null)
{
    Sanctum::actingAs($test->author);
    $request = test()->withHeader('X-Organization-Id', (string) $test->organization->id);

    if ($locale !== null) {
        $request->withHeader('Accept-Language', $locale);
    }

    return $request->postJson("/api/channels/{$test->channel->id}/messages", $data);
}

function linkedTo(int $attachmentId): ?int
{
    return DB::table('message_attachments')->where('id', $attachmentId)->value('message_id');
}

it('links own free attachments of the channel and returns them in the message', function () {
    $second = pendingAttachment($this->channel, $this->author, name: 'b.pdf');
    $first = pendingAttachment($this->channel, $this->author, name: 'a.pdf');

    $response = attachPost($this, ['body' => 'see files', 'attachment_ids' => [$first, $second]])
        ->assertCreated()
        ->assertJsonPath('data.body', 'see files')
        ->assertJsonCount(2, 'data.attachments')
        ->assertJsonPath('data.attachments.0.id', $second)
        ->assertJsonPath('data.attachments.1.id', $first)
        ->assertJsonPath('data.attachments.0.original_name', 'b.pdf');

    $id = $response->json('data.id');
    expect(array_keys($response->json('data.attachments.0')))->toBe(['id', 'original_name', 'mime', 'size', 'created_at', 'url'])
        ->and(linkedTo($first))->toBe($id)
        ->and(linkedTo($second))->toBe($id);
});

it('accepts a message without body when it has attachments', function (array $body) {
    $attachment = pendingAttachment($this->channel, $this->author);

    $id = attachPost($this, $body + ['attachment_ids' => [$attachment]])
        ->assertCreated()
        ->assertJsonPath('data.body', null)
        ->assertJsonPath('data.attachments.0.id', $attachment)
        ->json('data.id');

    expect(DB::table('messages')->where('id', $id)->value('body'))->toBeNull()
        ->and(linkedTo($attachment))->toBe($id);
})->with([
    'no body' => [[]],
    'null body' => [['body' => null]],
    'empty body' => [['body' => '']],
    'blank body' => [['body' => "  \n "]],
]);

it('rejects a message without body nor attachments', function (array $data) {
    attachPost($this, $data)->assertUnprocessable()->assertJsonValidationErrors('body');

    expect(DB::table('messages')->count())->toBe(0);
})->with([
    'nothing' => [[]],
    'blank body' => [['body' => '   ']],
    'empty list' => [['body' => '', 'attachment_ids' => []]],
    'null list' => [['attachment_ids' => null]],
]);

it('rejects attachments that are not free, own, of the channel and organization with the same error', function (string $case) {
    $free = pendingAttachment($this->channel, $this->author);
    $usedBy = DB::table('messages')->insertGetId([
        'organization_id' => $this->organization->id,
        'channel_id' => $this->channel->id,
        'user_id' => $this->author->id,
        'kind' => 'user',
        'body' => 'earlier',
    ]);
    $bad = match ($case) {
        'of another user' => pendingAttachment($this->channel, $this->ana),
        'of another channel' => pendingAttachment($this->sibling, $this->author),
        // Same channel id, so only the organization scope rejects it.
        'of another organization' => tap(pendingAttachment($this->channel, $this->author), fn ($id) => DB::table('message_attachments')
            ->where('id', $id)->update(['organization_id' => $this->other->id])),
        'already used' => pendingAttachment($this->channel, $this->author, $usedBy),
        'missing' => $free + 1000,
    };

    // Rejected by validation, before the insert (the link in the controller would also refuse it).
    $inserts = 0;
    Message::creating(function () use (&$inserts) {
        $inserts++;
    });

    $response = attachPost($this, ['body' => 'hi', 'attachment_ids' => [$free, $bad]])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['attachment_ids' => 'The attachments do not exist or are already in use.']);

    expect(array_keys($response->json('errors')))->toBe(['attachment_ids'])
        ->and($inserts)->toBe(0)
        ->and(DB::table('messages')->count())->toBe(1)
        ->and(linkedTo($free))->toBeNull();
})->with(['of another user', 'of another channel', 'of another organization', 'already used', 'missing']);

it('accepts the same attachments once the request is valid for them', function () {
    $attachment = pendingAttachment($this->channel, $this->author);

    attachPost($this, ['body' => 'hi', 'attachment_ids' => [$attachment]])->assertCreated();
    attachPost($this, ['body' => 'again', 'attachment_ids' => [$attachment]])
        ->assertUnprocessable()->assertJsonValidationErrors('attachment_ids');

    expect(DB::table('messages')->count())->toBe(1);
});

it('translates the attachment error', function () {
    $attachment = pendingAttachment($this->channel, $this->ana);

    attachPost($this, ['body' => 'hi', 'attachment_ids' => [$attachment]], 'es')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['attachment_ids' => 'Los adjuntos no existen o ya están en uso.']);
});

it('limits the attachments per message', function () {
    config(['chat.attachments.max_per_message' => 2]);
    $ids = collect(range(1, 3))->map(fn () => pendingAttachment($this->channel, $this->author))->all();

    attachPost($this, ['attachment_ids' => $ids])->assertUnprocessable()->assertJsonValidationErrors('attachment_ids');
    attachPost($this, ['attachment_ids' => array_slice($ids, 0, 2)])->assertCreated()->assertJsonCount(2, 'data.attachments');
});

it('rejects repeated and malformed attachment ids', function (mixed $ids, string $field) {
    $attachment = pendingAttachment($this->channel, $this->author);
    $ids = is_array($ids) ? array_map(fn ($id) => $id === 'own' ? $attachment : $id, $ids) : $ids;

    attachPost($this, ['body' => 'hi', 'attachment_ids' => $ids])
        ->assertUnprocessable()->assertJsonValidationErrors($field);

    expect(linkedTo($attachment))->toBeNull();
})->with([
    'repeated' => [['own', 'own'], 'attachment_ids.1'],
    'not a list' => ['own', 'attachment_ids'],
    'keyed' => [['a' => 'own'], 'attachment_ids'],
    'not an integer' => [['own', 'x'], 'attachment_ids.1'],
    'zero' => [['own', 0], 'attachment_ids.1'],
]);

it('rolls the whole message back when another message takes an attachment first', function () {
    Event::fake([MessageCreated::class, MentionCreated::class]);
    $taken = pendingAttachment($this->channel, $this->author);
    $free = pendingAttachment($this->channel, $this->author);
    $rival = DB::table('messages')->insertGetId([
        'organization_id' => $this->organization->id,
        'channel_id' => $this->channel->id,
        'user_id' => $this->author->id,
        'kind' => 'user',
        'body' => 'rival',
    ]);
    // Runs after validation, between the insert of the message and the link of its attachments.
    $raced = false;
    Message::creating(function () use (&$raced, $taken, $rival) {
        if (! $raced) {
            $raced = true;
            DB::table('message_attachments')->where('id', $taken)->update(['message_id' => $rival]);
        }
    });

    attachPost($this, ['body' => "hi <@{$this->ana->id}>", 'attachment_ids' => [$free, $taken]])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['attachment_ids' => 'The attachments do not exist or are already in use.']);

    expect($raced)->toBeTrue()
        ->and(DB::table('messages')->count())->toBe(1)
        ->and(DB::table('message_mentions')->count())->toBe(0)
        ->and(linkedTo($free))->toBeNull()
        // The simulated rival runs inside the same transaction, so the rollback also undoes it.
        ->and(linkedTo($taken))->toBeNull();
    Event::assertNotDispatched(MessageCreated::class);
    Event::assertNotDispatched(MentionCreated::class);
});

it('attaches files to a thread reply and lists them in the replies', function () {
    $root = attachPost($this, ['body' => 'root'])->assertCreated()->json('data.id');
    $attachment = pendingAttachment($this->channel, $this->author);

    $reply = attachPost($this, ['parent_id' => $root, 'attachment_ids' => [$attachment]])
        ->assertCreated()
        ->assertJsonPath('data.parent_id', $root)
        ->assertJsonPath('data.attachments.0.id', $attachment)
        ->json('data.id');

    $this->getJson("/api/channels/{$this->channel->id}/messages/{$root}/replies")
        ->assertOk()
        ->assertJsonPath('data.0.id', $reply)
        ->assertJsonPath('data.0.body', null)
        ->assertJsonPath('data.0.attachments.0.id', $attachment);
    expect(DB::table('messages')->where('id', $root)->value('replies_count'))->toBe(1);
});

it('returns an empty attachment list for messages without attachments', function () {
    attachPost($this, ['body' => 'plain'])->assertCreated()->assertJsonPath('data.attachments', []);

    $this->getJson("/api/channels/{$this->channel->id}/messages")
        ->assertOk()->assertJsonPath('data.0.attachments', []);
});

it('lists attachments in the channel and the replies without extra queries per message', function () {
    $root = attachPost($this, ['body' => 'root'])->json('data.id');
    $post = function () use ($root) {
        foreach ([null, $root] as $parentId) {
            $ids = [pendingAttachment($this->channel, $this->author), pendingAttachment($this->channel, $this->author)];
            attachPost($this, array_filter(['parent_id' => $parentId, 'attachment_ids' => $ids]))->assertCreated();
        }
    };
    $count = function (string $uri) {
        DB::flushQueryLog();
        DB::enableQueryLog();
        test()->getJson($uri)->assertOk();

        return count(DB::getQueryLog());
    };
    $list = "/api/channels/{$this->channel->id}/messages";
    $replies = "{$list}/{$root}/replies";
    $post();
    $few = [$count($list), $count($replies)];

    foreach (range(1, 3) as $i) {
        $post();
    }

    expect([$count($list), $count($replies)])->toBe($few);
    $this->getJson($list)->assertJsonCount(2, 'data.0.attachments');
    $this->getJson($replies)->assertJsonCount(2, 'data.0.attachments');
});

it('shows the attachments in the mentions inbox without extra queries per mention', function () {
    $post = function () {
        attachPost($this, [
            'body' => "look <@{$this->ana->id}>",
            'attachment_ids' => [pendingAttachment($this->channel, $this->author)],
        ])->assertCreated();
    };
    $count = function () {
        Sanctum::actingAs($this->ana);
        DB::flushQueryLog();
        DB::enableQueryLog();
        $response = test()->withHeader('X-Organization-Id', (string) $this->organization->id)->getJson('/api/mentions')->assertOk();

        return [count(DB::getQueryLog()), $response];
    };
    $post();
    $count();
    [$few] = $count();

    foreach (range(1, 3) as $i) {
        $post();
    }
    [$many, $response] = $count();

    expect($many)->toBe($few);
    $response->assertJsonCount(4, 'data')->assertJsonCount(1, 'data.0.message.attachments');
});

it('broadcasts the attachments in message.created and mention.created', function () {
    Event::fake([MessageCreated::class, MentionCreated::class]);
    $attachment = pendingAttachment($this->channel, $this->author);

    attachPost($this, ['body' => "<@{$this->ana->id}>", 'attachment_ids' => [$attachment]])->assertCreated();

    $expected = fn (array $message) => count($message['attachments']) === 1
        && $message['attachments'][0]['id'] === $attachment
        && $message['attachments'][0]['original_name'] === 'report.pdf'
        && ! array_key_exists('path', $message['attachments'][0]);
    Event::assertDispatched(MessageCreated::class, fn (MessageCreated $event) => $expected($event->broadcastWith()['message']));
    Event::assertDispatched(MentionCreated::class, fn (MentionCreated $event) => $expected($event->broadcastWith()['message']));
});

it('broadcasts system messages with an empty attachment list', function () {
    Event::fake([MessageCreated::class]);
    app(CurrentOrganization::class)->set($this->organization);

    Message::factory()->for($this->channel)->system(['type' => 'log.group_opened'])->create();

    Event::assertDispatched(MessageCreated::class, fn (MessageCreated $event) => $event->message['attachments'] === []);
});
