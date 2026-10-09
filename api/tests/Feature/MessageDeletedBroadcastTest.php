<?php

use App\Enums\Role;
use App\Events\MessageDeleted;
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
    $this->author = User::factory()->create();
    $this->organization->addMember($this->author, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->root = Message::factory()->for($this->channel)->create(['kind' => Message::KIND_USER, 'user_id' => $this->author->id, 'body' => 'root']);
    $this->reply = Message::factory()->for($this->channel)->create(['kind' => Message::KIND_USER, 'user_id' => $this->author->id, 'body' => 'reply']);
    $this->reply->parent_id = $this->root->id;
    $this->reply->save();
    DB::table('messages')->where('id', $this->root->id)->update(['replies_count' => 1, 'last_reply_at' => $this->reply->created_at]);
});

function deletedBroadcastCall(object $test, Message $message): void
{
    Sanctum::actingAs($test->author);
    test()->withHeader('X-Organization-Id', (string) $test->organization->id)
        ->deleteJson("/api/channels/{$test->channel->id}/messages/{$message->id}")
        ->assertOk();
}

it('broadcasts a deleted reply with the recalculated counters of its root', function () {
    Event::fake([MessageDeleted::class]);

    deletedBroadcastCall($this, $this->reply);

    Event::assertDispatchedTimes(MessageDeleted::class, 1);
    Event::assertDispatched(MessageDeleted::class, function (MessageDeleted $event) {
        $payload = $event->broadcastWith();

        return $event->broadcastOn()->name === "private-organizations.{$this->organization->id}.channels.{$this->channel->id}"
            && $event->broadcastAs() === 'message.deleted'
            && $payload['id'] === $this->reply->id
            && $payload['channel_id'] === $this->channel->id
            && $payload['parent_id'] === $this->root->id
            && $payload['deleted_at'] !== null
            && $payload['root'] === ['id' => $this->root->id, 'replies_count' => 0, 'last_reply_at' => null];
    });
});

it('broadcasts a deleted root with its own counters', function () {
    Event::fake([MessageDeleted::class]);

    deletedBroadcastCall($this, $this->root);

    Event::assertDispatched(MessageDeleted::class, function (MessageDeleted $event) {
        $payload = $event->broadcastWith();

        return $payload['id'] === $this->root->id
            && $payload['parent_id'] === null
            && $payload['root']['id'] === $this->root->id
            && $payload['root']['replies_count'] === 1
            && $payload['root']['last_reply_at'] !== null;
    });
});

it('does not broadcast when the delete is rejected', function () {
    Event::fake([MessageDeleted::class]);
    $stranger = User::factory()->create();
    $this->organization->addMember($stranger, [Role::Member]);

    Sanctum::actingAs($stranger);
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/channels/{$this->channel->id}/messages/{$this->reply->id}")
        ->assertForbidden();

    Event::assertNotDispatched(MessageDeleted::class);
});

it('survives queue serialization without an active organization', function () {
    Event::fake([MessageDeleted::class]);
    deletedBroadcastCall($this, $this->reply);
    $event = Event::dispatched(MessageDeleted::class)->first()[0];

    app(CurrentOrganization::class)->set(null);
    $restored = unserialize(serialize($event));

    expect($restored->broadcastOn()->name)->toBe($event->broadcastOn()->name)
        ->and($restored->broadcastAs())->toBe('message.deleted')
        ->and($restored->broadcastWith())->toEqual($event->broadcastWith());
});
