<?php

use App\Enums\Role;
use App\Events\MentionRemoved;
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
    $this->author = User::factory()->create(['name' => 'Author']);
    $this->ana = User::factory()->create(['name' => 'Ana']);
    $this->bob = User::factory()->create(['name' => 'Bob']);
    foreach ([$this->author, $this->ana, $this->bob] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    Sanctum::actingAs($this->author);
    $this->message = Message::find($this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => "hi <@{$this->ana->id}> <@{$this->bob->id}>"])
        ->assertCreated()->json('data.id'));
});

function removedMentionCall(object $test, string $method, ?string $body = null): void
{
    Sanctum::actingAs($test->author);
    test()->withHeader('X-Organization-Id', (string) $test->organization->id)
        ->json($method, "/api/channels/{$test->channel->id}/messages/{$test->message->id}", $body === null ? [] : ['body' => $body])
        ->assertOk();
}

it('emits mention.removed to each user whose mention an edit drops', function () {
    Event::fake([MentionRemoved::class]);

    removedMentionCall($this, 'PATCH', "hi <@{$this->ana->id}>");

    Event::assertDispatchedTimes(MentionRemoved::class, 1);
    Event::assertDispatched(MentionRemoved::class, function (MentionRemoved $e) {
        $payload = $e->broadcastWith();

        return $e->broadcastOn()->name === "private-users.{$this->bob->id}"
            && $e->broadcastAs() === 'mention.removed'
            && array_keys($payload) === ['organization_id', 'channel_id', 'parent_id', 'message_id']
            && $payload['organization_id'] === $this->organization->id
            && $payload['channel_id'] === $this->channel->id
            && $payload['message_id'] === $this->message->id;
    });
});

it('does not emit when an edit keeps the mentions', function () {
    Event::fake([MentionRemoved::class]);

    removedMentionCall($this, 'PATCH', "hello <@{$this->ana->id}> <@{$this->bob->id}>");

    Event::assertNotDispatched(MentionRemoved::class);
});

it('emits mention.removed to every mentioned user when the message is deleted', function () {
    Event::fake([MentionRemoved::class]);

    removedMentionCall($this, 'DELETE');

    Event::assertDispatchedTimes(MentionRemoved::class, 2);
    foreach ([$this->ana, $this->bob] as $user) {
        Event::assertDispatched(MentionRemoved::class, fn (MentionRemoved $e) => $e->broadcastOn()->name === "private-users.{$user->id}"
            && $e->broadcastWith()['message_id'] === $this->message->id);
    }
});

it('does not send the edited body to a former member whose mention is dropped', function () {
    Event::fake([MentionRemoved::class]);
    DB::table('organization_user')->where('organization_id', $this->organization->id)->where('user_id', $this->bob->id)->delete();

    removedMentionCall($this, 'PATCH', 'secret new text');

    Event::assertDispatched(MentionRemoved::class, function (MentionRemoved $e) {
        return $e->broadcastOn()->name === "private-users.{$this->bob->id}"
            && ! str_contains(json_encode($e->broadcastWith()), 'secret')
            && ! array_key_exists('message', $e->broadcastWith());
    });
});

it('survives queue serialization without an active organization', function () {
    Event::fake([MentionRemoved::class]);
    removedMentionCall($this, 'DELETE');
    $event = Event::dispatched(MentionRemoved::class)->first()[0];

    app(CurrentOrganization::class)->set(null);
    $restored = unserialize(serialize($event));

    expect($restored->broadcastOn()->name)->toBe($event->broadcastOn()->name)
        ->and($restored->broadcastAs())->toBe('mention.removed')
        ->and($restored->broadcastWith())->toEqual($event->broadcastWith());
});
