<?php

use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create();
    $this->message = Message::factory()->for($this->channel)->create();
    $this->uploader = User::factory()->create();
});

function attachmentIn(Channel $channel, ?Message $message = null, ?User $uploader = null): MessageAttachment
{
    $attachment = new MessageAttachment;
    $attachment->organization_id = $channel->organization_id;
    $attachment->channel_id = $channel->id;
    $attachment->message_id = $message?->id;
    $attachment->uploaded_by = $uploader?->id;
    $attachment->disk = 'local';
    $attachment->path = 'chat/'.fake()->uuid();
    $attachment->original_name = 'report.pdf';
    $attachment->mime = 'application/pdf';
    $attachment->size = 1234;
    $attachment->save();

    return $attachment;
}

it('has sane defaults in the chat config', function () {
    expect(config('chat.attachments.disk'))->toBe('local')
        ->and(config('chat.attachments.max_size_kb'))->toBe(5120)
        ->and(config('chat.attachments.max_per_message'))->toBeGreaterThan(0)
        ->and(config('chat.attachments.url_ttl_minutes'))->toBeGreaterThan(0)
        ->and(config('chat.attachments.orphan_hours'))->toBe(24);
});

it('stores an unlinked attachment and fills the organization', function () {
    $attachment = attachmentIn($this->channel, null, $this->uploader)->refresh();

    expect($attachment->organization_id)->toBe($this->organization->id)
        ->and($attachment->message_id)->toBeNull()
        ->and($attachment->size)->toBe(1234)
        ->and($attachment->created_at)->not->toBeNull()
        ->and($attachment->channel->is($this->channel))->toBeTrue()
        ->and($attachment->uploader->is($this->uploader))->toBeTrue();
});

it('links an attachment to a message of the same channel', function () {
    $attachment = attachmentIn($this->channel, $this->message);

    expect($this->message->attachments()->pluck('id')->all())->toBe([$attachment->id])
        ->and($attachment->message->is($this->message))->toBeTrue();
});

it('rejects a message from another channel', function () {
    $otherChannel = Channel::factory()->for(Project::factory()->for($this->organization)->create())->create();
    $foreign = Message::factory()->for($otherChannel)->create();

    attachmentIn($this->channel, $foreign);
})->throws(QueryException::class, 'message_attachments_message_fk');

it('deletes attachments with the message', function () {
    attachmentIn($this->channel, $this->message);
    $loose = attachmentIn($this->channel);
    $this->message->delete();

    expect(MessageAttachment::pluck('id')->all())->toBe([$loose->id]);
});

it('deletes attachments with the channel, linked or not', function () {
    attachmentIn($this->channel, $this->message);
    attachmentIn($this->channel);
    $this->channel->delete();

    expect(MessageAttachment::withoutGlobalScopes()->count())->toBe(0);
});

it('keeps the attachment when the uploader is deleted', function () {
    $attachment = attachmentIn($this->channel, $this->message, $this->uploader);
    $this->uploader->delete();

    expect($attachment->refresh()->uploaded_by)->toBeNull();
});

it('scopes attachments to the active organization', function () {
    attachmentIn($this->channel, $this->message);

    app(CurrentOrganization::class)->set(Organization::factory()->create());

    expect(MessageAttachment::count())->toBe(0)
        ->and(MessageAttachment::withoutGlobalScopes()->count())->toBe(1);
});

it('has indexes for loading by message and for the orphan sweep', function () {
    $indexes = collect(DB::select(
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'message_attachments'"
    ))->pluck('indexdef', 'indexname');

    expect($indexes->keys()->all())->toContain('message_attachments_message_id_index', 'message_attachments_orphans_index')
        ->and($indexes['message_attachments_orphans_index'])->toContain('created_at', 'message_id IS NULL');
});
