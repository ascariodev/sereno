<?php

use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageMention;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create();
    $this->message = Message::factory()->for($this->channel)->create();
    $this->mentioned = User::factory()->create();
});

function mentionIn(Message $message, User $user): MessageMention
{
    $mention = new MessageMention;
    $mention->organization_id = $message->organization_id;
    $mention->message_id = $message->id;
    $mention->user_id = $user->id;
    $mention->save();

    return $mention;
}

it('stores an unread mention and fills the organization', function () {
    $mention = mentionIn($this->message, $this->mentioned)->refresh();

    expect($mention->organization_id)->toBe($this->organization->id)
        ->and($mention->read_at)->toBeNull()
        ->and($mention->created_at)->not->toBeNull()
        ->and($mention->message->is($this->message))->toBeTrue()
        ->and($mention->user->is($this->mentioned))->toBeTrue()
        ->and($this->message->mentions()->count())->toBe(1);
});

it('rejects mentioning the same user twice in a message', function () {
    mentionIn($this->message, $this->mentioned);
    mentionIn($this->message, $this->mentioned);
})->throws(QueryException::class, 'message_mentions_message_id_user_id_unique');

it('allows the same user in different messages', function () {
    $other = Message::factory()->for($this->channel)->create();
    mentionIn($this->message, $this->mentioned);
    mentionIn($other, $this->mentioned);

    expect(MessageMention::count())->toBe(2);
});

it('deletes mentions with the message', function () {
    mentionIn($this->message, $this->mentioned);
    $this->message->delete();

    expect(MessageMention::count())->toBe(0);
});

it('deletes mentions with the organization', function () {
    mentionIn($this->message, $this->mentioned);
    $this->organization->delete();

    expect(MessageMention::withoutGlobalScopes()->count())->toBe(0);
});

it('keeps the mention when only the user is not deleted and drops it with the user', function () {
    mentionIn($this->message, $this->mentioned);
    $this->mentioned->delete();

    expect(MessageMention::count())->toBe(0);
});

it('scopes mentions to the active organization', function () {
    mentionIn($this->message, $this->mentioned);

    $other = Organization::factory()->create();
    app(CurrentOrganization::class)->set($other);

    expect(MessageMention::count())->toBe(0)
        ->and(MessageMention::withoutGlobalScopes()->count())->toBe(1);
});
