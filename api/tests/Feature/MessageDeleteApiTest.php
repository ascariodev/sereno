<?php

use App\Chat\MessageDeletion;
use App\Enums\Role;
use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    Storage::fake('local');
    RateLimiter::clear('channel-messages');
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->author = User::factory()->create(['name' => 'Author']);
    $this->ana = User::factory()->create(['name' => 'Ana']);
    $this->peer = User::factory()->create();
    foreach ([$this->author, $this->ana, $this->peer] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->other->addMember($this->author, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->message = destroyUserMessage($this->channel, $this->author, 'hello <@'.$this->ana->id.'>');
});

function destroyUserMessage(Channel $channel, User $author, ?string $body = 'text', ?Message $parent = null): Message
{
    $message = Message::factory()->for($channel)->create([
        'kind' => Message::KIND_USER,
        'user_id' => $author->id,
        'body' => $body,
    ]);

    if ($parent !== null) {
        $message->parent_id = $parent->id;
        $message->save();
        DB::table('messages')->where('id', $parent->id)->update([
            'replies_count' => DB::raw('replies_count + 1'),
            'last_reply_at' => DB::raw('GREATEST(last_reply_at, '.DB::getPdo()->quote($message->created_at->format('Y-m-d H:i:s')).'::timestamp)'),
        ]);
    }

    return $message;
}

function destroyAttachmentOf(Message $message): MessageAttachment
{
    $path = "chat/{$message->organization_id}/{$message->channel_id}/".fake()->uuid();
    Storage::disk('local')->put($path, 'data');

    $attachment = new MessageAttachment;
    $attachment->organization_id = $message->organization_id;
    $attachment->channel_id = $message->channel_id;
    $attachment->message_id = $message->id;
    $attachment->uploaded_by = $message->user_id;
    $attachment->disk = 'local';
    $attachment->path = $path;
    $attachment->original_name = 'a.txt';
    $attachment->mime = 'text/plain';
    $attachment->size = 4;
    $attachment->save();

    return $attachment;
}

function destroyCall(object $test, User $as, ?Message $message = null, ?Organization $org = null)
{
    Sanctum::actingAs($as);
    $message ??= $test->message;

    return test()->withHeader('X-Organization-Id', (string) ($org ?? $test->organization)->id)
        ->deleteJson("/api/channels/{$message->channel_id}/messages/{$message->id}");
}

it('soft deletes the message, its mentions and attachment rows, and hides its content', function () {
    DB::table('message_mentions')->insert([
        'organization_id' => $this->organization->id,
        'message_id' => $this->message->id,
        'user_id' => $this->ana->id,
        'created_at' => now(),
    ]);
    $attachment = destroyAttachmentOf($this->message);
    $this->freezeTime();

    destroyCall($this, $this->author)->assertOk()
        ->assertJsonPath('data.id', $this->message->id)
        ->assertJsonPath('data.deleted_at', now()->startOfSecond()->toJSON())
        ->assertJsonPath('data.body', null)
        ->assertJsonPath('data.mentions', [])
        ->assertJsonPath('data.attachments', [])
        ->assertJsonPath('data.user.id', $this->author->id)
        ->assertJsonMissingPath('meta.root');

    $row = DB::table('messages')->where('id', $this->message->id)->first();
    expect($row->deleted_at)->not->toBeNull()
        ->and($row->body)->toBeNull()
        ->and(DB::table('message_mentions')->where('message_id', $this->message->id)->exists())->toBeFalse()
        ->and(DB::table('message_attachments')->where('id', $attachment->id)->exists())->toBeFalse();
    Storage::disk('local')->assertMissing($attachment->path);
});

it('keeps the attachment files when the transaction rolls back', function () {
    $attachment = destroyAttachmentOf($this->message);
    app(CurrentOrganization::class)->set($this->organization);

    try {
        DB::transaction(function () {
            app(MessageDeletion::class)->delete($this->message);

            throw new RuntimeException('rollback');
        });
    } catch (RuntimeException) {
    }

    expect(DB::table('messages')->where('id', $this->message->id)->value('deleted_at'))->toBeNull()
        ->and(DB::table('message_attachments')->where('id', $attachment->id)->exists())->toBeTrue();
    Storage::disk('local')->assertExists($attachment->path);
});

it('takes a deleted reply off the root counters and recomputes last_reply_at from live replies', function () {
    $root = destroyUserMessage($this->channel, $this->peer, 'root');
    $first = destroyUserMessage($this->channel, $this->ana, 'first', $root);
    $this->travel(5)->minutes();
    $last = destroyUserMessage($this->channel, $this->author, 'last', $root);
    expect($root->refresh()->replies_count)->toBe(2);

    destroyCall($this, $this->author, $last)->assertOk()
        ->assertJsonPath('data.id', $last->id)
        ->assertJsonPath('meta.root.id', $root->id)
        ->assertJsonPath('meta.root.replies_count', 1)
        ->assertJsonPath('meta.root.last_reply_at', $first->created_at->toJSON());

    $root->refresh();
    expect($root->replies_count)->toBe(1)
        ->and($root->last_reply_at->equalTo($first->created_at))->toBeTrue();

    destroyCall($this, $this->ana, $first)->assertOk()->assertJsonPath('meta.root.replies_count', 0);

    $root->refresh();
    expect($root->replies_count)->toBe(0)->and($root->last_reply_at)->toBeNull();
});

it('keeps the counters right when a reply is sent while another one is being deleted', function () {
    $root = destroyUserMessage($this->channel, $this->peer, 'root');
    $old = destroyUserMessage($this->channel, $this->author, 'old', $root);
    $this->travel(5)->minutes();
    $deletedMidway = false;

    // The new reply is inserted but its `replies_count + 1` has not run yet when the delete takes the root:
    // a recount would include it and the store's increment would count it twice.
    Message::created(function (Message $message) use ($root, $old, &$deletedMidway) {
        if ($message->parent_id === $root->id && ! $deletedMidway) {
            $deletedMidway = true;
            expect(app(MessageDeletion::class)->delete($old))->not->toBeNull();
        }
    });

    Sanctum::actingAs($this->author);
    $reply = $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => 'new', 'parent_id' => $root->id])
        ->assertCreated()->json('data');

    $root->refresh();
    expect($deletedMidway)->toBeTrue()
        ->and($root->replies_count)->toBe(1)
        ->and($root->last_reply_at->toJSON())->toBe($reply['created_at'])
        ->and($old->refresh()->deleted_at)->not->toBeNull();
});

it('locks the root before the reply, the same order as a reply sent at the same time', function () {
    $root = destroyUserMessage($this->channel, $this->peer, 'root');
    $reply = destroyUserMessage($this->channel, $this->author, 'reply', $root);
    $locks = [];
    DB::listen(function (QueryExecuted $query) use (&$locks) {
        if (str_contains(strtolower($query->sql), 'for update')) {
            $locks[] = $query->bindings[0];
        }
    });

    destroyCall($this, $this->author, $reply)->assertOk();

    expect($locks)->toBe([$root->id, $reply->id]);
});

it('lets only the author delete a live user message', function () {
    destroyCall($this, $this->ana)->assertForbidden();
    destroyCall($this, $this->peer)->assertForbidden();

    $system = Message::factory()->system()->for($this->channel)->create();
    destroyCall($this, $this->author, $system)->assertForbidden();

    destroyCall($this, $this->author)->assertOk();
    destroyCall($this, $this->author)->assertForbidden();

    expect(DB::table('messages')->where('id', $system->id)->value('deleted_at'))->toBeNull();
});

it('isolates organizations and channels', function () {
    destroyCall($this, $this->author, org: $this->other)->assertNotFound();

    $outsider = User::factory()->create();
    destroyCall($this, $outsider)->assertForbidden();

    $otherChannel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    Sanctum::actingAs($this->author);
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/channels/{$otherChannel->id}/messages/{$this->message->id}")
        ->assertNotFound();

    expect(DB::table('messages')->where('id', $this->message->id)->value('deleted_at'))->toBeNull();
});

it('rejects deleting in an archived channel', function () {
    $this->channel->forceFill(['archived_at' => now()])->save();

    destroyCall($this, $this->author)->assertUnprocessable()->assertJsonValidationErrors('channel');

    expect(DB::table('messages')->where('id', $this->message->id)->value('deleted_at'))->toBeNull();
});
