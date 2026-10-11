<?php

use App\Enums\Role;
use App\Events\MentionCreated;
use App\Events\MessageUpdated;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    RateLimiter::clear('channel-messages');
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->author = User::factory()->create(['name' => 'Author']);
    $this->ana = User::factory()->create(['name' => 'Ana']);
    $this->bob = User::factory()->create(['name' => 'Bob']);
    $this->peer = User::factory()->create();
    foreach ([$this->author, $this->ana, $this->bob, $this->peer] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->foreign = User::factory()->create();
    $this->other->addMember($this->foreign, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->message = Message::factory()->for($this->channel)->create([
        'kind' => Message::KIND_USER,
        'user_id' => $this->author->id,
        'body' => 'original',
    ]);

    assignMembersToAllProjects();
});

function patchEdit(object $test, User $as, ?Message $message = null, array $payload = ['body' => 'changed'], ?Organization $org = null)
{
    Sanctum::actingAs($as);
    $message ??= $test->message;

    return test()->withHeader('X-Organization-Id', (string) ($org ?? $test->organization)->id)
        ->patchJson("/api/channels/{$message->channel_id}/messages/{$message->id}", $payload);
}

function editMentionRows(int $messageId): array
{
    return DB::table('message_mentions')->where('message_id', $messageId)->orderBy('user_id')->pluck('user_id')->all();
}

it('edits the body, sets edited_at and returns the message', function () {
    $this->freezeTime();

    patchEdit($this, $this->author)->assertOk()
        ->assertJsonPath('data.id', $this->message->id)
        ->assertJsonPath('data.body', 'changed')
        ->assertJsonPath('data.edited_at', now()->startOfSecond()->toJSON())
        ->assertJsonPath('data.user.id', $this->author->id);

    expect($this->message->refresh()->body)->toBe('changed')
        ->and($this->message->edited_at)->not->toBeNull();
});

it('leaves edited_at null when the body does not change', function () {
    patchEdit($this, $this->author, payload: ['body' => 'original'])->assertOk()
        ->assertJsonPath('data.edited_at', null);

    expect($this->message->refresh()->edited_at)->toBeNull();
});

it('rejects an empty body without attachments and accepts it with attachments', function () {
    patchEdit($this, $this->author, payload: ['body' => ''])->assertUnprocessable()->assertJsonValidationErrors('body');

    DB::table('message_attachments')->insert([
        'organization_id' => $this->organization->id,
        'channel_id' => $this->channel->id,
        'message_id' => $this->message->id,
        'uploaded_by' => $this->author->id,
        'disk' => 'local',
        'path' => 'chat/'.fake()->uuid(),
        'original_name' => 'a.pdf',
        'mime' => 'application/pdf',
        'size' => 10,
    ]);

    patchEdit($this, $this->author, payload: ['body' => ''])->assertOk()->assertJsonPath('data.body', null);
});

it('rejects an archived channel', function () {
    $this->channel->forceFill(['archived_at' => now()])->save();

    patchEdit($this, $this->author)->assertUnprocessable()->assertJsonValidationErrors('channel');
    expect($this->message->refresh()->body)->toBe('original');
});

it('only lets the author edit a live user message', function () {
    patchEdit($this, $this->ana)->assertForbidden();

    $this->organization->addMember($admin = User::factory()->create(), [Role::Admin]);
    patchEdit($this, $admin)->assertForbidden();

    DB::table('messages')->where('id', $this->message->id)->update(['deleted_at' => now()]);
    patchEdit($this, $this->author)->assertForbidden();

    expect(DB::table('messages')->where('id', $this->message->id)->value('body'))->toBe('original');
});

it('does not touch another organization or a message of another channel', function () {
    patchEdit($this, $this->foreign, org: $this->other)->assertNotFound();
    patchEdit($this, $this->author, org: $this->other)->assertForbidden();

    $otherChannel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    Sanctum::actingAs($this->author);
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->patchJson("/api/channels/{$otherChannel->id}/messages/{$this->message->id}", ['body' => 'x'])
        ->assertNotFound();

    expect($this->message->refresh()->body)->toBe('original');
});

it('requires authentication', function () {
    $this->patchJson("/api/channels/{$this->channel->id}/messages/{$this->message->id}", ['body' => 'x'])
        ->assertUnauthorized();
});

it('throttles edits with the channel-messages limiter', function () {
    for ($i = 0; $i < 30; $i++) {
        patchEdit($this, $this->author, payload: ['body' => "v{$i}"])->assertOk();
    }

    patchEdit($this, $this->author, payload: ['body' => 'late'])->assertStatus(429);
});

it('adds new mentions, removes dropped ones and dispatches MentionCreated only for the new', function () {
    $message = Message::factory()->for($this->channel)->create([
        'kind' => Message::KIND_USER, 'user_id' => $this->author->id, 'body' => "<@{$this->ana->id}>",
    ]);
    DB::table('message_mentions')->insert([
        'organization_id' => $this->organization->id, 'message_id' => $message->id,
        'user_id' => $this->ana->id, 'created_at' => now(),
    ]);
    Event::fake([MentionCreated::class]);

    patchEdit($this, $this->author, $message, ['body' => "<@{$this->bob->id}> and <@{$this->author->id}>"])->assertOk()
        ->assertJsonPath('data.mentions', [['id' => $this->bob->id, 'name' => 'Bob']]);

    expect(editMentionRows($message->id))->toBe([$this->bob->id]);
    Event::assertDispatchedTimes(MentionCreated::class, 1);
    Event::assertDispatched(MentionCreated::class, fn ($e) => $e->userId === $this->bob->id);
});

it('keeps existing mentions without re-notifying when the text still names them', function () {
    patchEdit($this, $this->author, payload: ['body' => "hi <@{$this->ana->id}>"])->assertOk();

    Event::fake([MentionCreated::class]);
    patchEdit($this, $this->author, payload: ['body' => "hello <@{$this->ana->id}>"])->assertOk();

    expect(editMentionRows($this->message->id))->toBe([$this->ana->id]);
    Event::assertNotDispatched(MentionCreated::class);
});

it('returns the thread summary of an edited root', function () {
    $reply = Message::factory()->for($this->channel)->create([
        'kind' => Message::KIND_USER, 'user_id' => $this->ana->id, 'parent_id' => $this->message->id, 'body' => 'r',
    ]);
    DB::table('messages')->where('id', $this->message->id)->update(['replies_count' => 1, 'last_reply_at' => $reply->created_at]);

    patchEdit($this, $this->author)->assertOk()
        ->assertJsonPath('data.replies_count', 1)
        ->assertJsonPath('data.recent_participants', [['id' => $this->ana->id, 'name' => 'Ana']]);
});

function addEditAttachment(object $test, string $path): int
{
    return DB::table('message_attachments')->insertGetId([
        'organization_id' => $test->organization->id,
        'channel_id' => $test->channel->id,
        'message_id' => $test->message->id,
        'uploaded_by' => $test->author->id,
        'disk' => 'local',
        'path' => $path,
        'original_name' => 'a.pdf',
        'mime' => 'application/pdf',
        'size' => 10,
    ]);
}

it('removes attachments, deletes their files after commit and counts it as an edit', function () {
    Storage::fake('local');
    Storage::disk('local')->put('chat/a', 'x');
    Storage::disk('local')->put('chat/b', 'y');
    $a = addEditAttachment($this, 'chat/a');
    $b = addEditAttachment($this, 'chat/b');
    Event::fake([MessageUpdated::class]);

    patchEdit($this, $this->author, payload: ['body' => 'original', 'remove_attachment_ids' => [$a]])->assertOk()
        ->assertJsonCount(1, 'data.attachments')
        ->assertJsonPath('data.attachments.0.id', $b);

    expect(DB::table('message_attachments')->where('message_id', $this->message->id)->pluck('id')->all())->toBe([$b])
        ->and($this->message->refresh()->edited_at)->not->toBeNull();
    Storage::disk('local')->assertMissing('chat/a');
    Storage::disk('local')->assertExists('chat/b');
    Event::assertDispatched(MessageUpdated::class);
});

it('rejects removing the last attachment of a message without text and keeps the file', function () {
    Storage::fake('local');
    Storage::disk('local')->put('chat/a', 'x');
    $a = addEditAttachment($this, 'chat/a');
    $this->message->forceFill(['body' => null])->save();

    patchEdit($this, $this->author, payload: ['body' => null, 'remove_attachment_ids' => [$a]])
        ->assertUnprocessable()->assertJsonValidationErrors('body');
    patchEdit($this, $this->author, payload: ['remove_attachment_ids' => [$a]])
        ->assertUnprocessable()->assertJsonValidationErrors('body');

    expect(DB::table('message_attachments')->where('id', $a)->exists())->toBeTrue();
    Storage::disk('local')->assertExists('chat/a');
});

it('allows removing the last attachment when the message keeps text', function () {
    Storage::fake('local');
    Storage::disk('local')->put('chat/a', 'x');
    $a = addEditAttachment($this, 'chat/a');

    patchEdit($this, $this->author, payload: ['body' => 'original', 'remove_attachment_ids' => [$a]])->assertOk()
        ->assertJsonCount(0, 'data.attachments');
    Storage::disk('local')->assertMissing('chat/a');
});

it('rejects removing attachments that are not of the message', function () {
    $foreign = Message::factory()->for($this->channel)->create(['kind' => Message::KIND_USER, 'user_id' => $this->author->id, 'body' => 'x']);
    $id = DB::table('message_attachments')->insertGetId([
        'organization_id' => $this->organization->id,
        'channel_id' => $this->channel->id,
        'message_id' => $foreign->id,
        'uploaded_by' => $this->author->id,
        'disk' => 'local',
        'path' => 'chat/z',
        'original_name' => 'a.pdf',
        'mime' => 'application/pdf',
        'size' => 10,
    ]);

    patchEdit($this, $this->author, payload: ['body' => 'original', 'remove_attachment_ids' => [$id, 99999999]])
        ->assertUnprocessable()->assertJsonValidationErrors(['remove_attachment_ids.0', 'remove_attachment_ids.1']);
    expect(DB::table('message_attachments')->where('id', $id)->exists())->toBeTrue();
});
