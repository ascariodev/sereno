<?php

use App\Enums\Role;
use App\Events\MessageUpdated;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Broadcasting\BroadcastEvent;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    RateLimiter::clear('channel-messages');
    $this->organization = Organization::factory()->create();
    $this->author = User::factory()->create(['name' => 'Ana']);
    $this->organization->addMember($this->author, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->message = Message::factory()->for($this->channel)->create([
        'kind' => Message::KIND_USER,
        'user_id' => $this->author->id,
        'body' => 'original',
    ]);
});

function patchBroadcastEdit(object $test, string $body): void
{
    Sanctum::actingAs($test->author);
    test()->withHeader('X-Organization-Id', (string) $test->organization->id)
        ->patchJson("/api/channels/{$test->channel->id}/messages/{$test->message->id}", ['body' => $body])
        ->assertOk();
}

it('broadcasts an edit on the private channel with the resolved message', function () {
    Event::fake([MessageUpdated::class]);

    patchBroadcastEdit($this, 'changed');

    Event::assertDispatchedTimes(MessageUpdated::class, 1);
    Event::assertDispatched(MessageUpdated::class, function (MessageUpdated $event) {
        $payload = $event->broadcastWith()['message'];

        return $event->broadcastOn()->name === "private-organizations.{$this->organization->id}.channels.{$this->channel->id}"
            && $event->broadcastAs() === 'message.updated'
            && $payload['id'] === $this->message->id
            && $payload['body'] === 'changed'
            && $payload['edited_at'] !== null
            && $payload['user'] === ['id' => $this->author->id, 'name' => 'Ana'];
    });
});

it('does not broadcast when the body does not change', function () {
    Event::fake([MessageUpdated::class]);

    patchBroadcastEdit($this, 'original');

    Event::assertNotDispatched(MessageUpdated::class);
});

it('carries the thread participants of an edited root', function () {
    Event::fake([MessageUpdated::class]);
    Message::factory()->for($this->channel)->create([
        'kind' => Message::KIND_USER,
        'user_id' => $this->author->id,
        'parent_id' => $this->message->id,
    ]);
    DB::table('messages')->where('id', $this->message->id)->update(['replies_count' => 1]);

    patchBroadcastEdit($this, 'changed');

    Event::assertDispatched(MessageUpdated::class, fn (MessageUpdated $event) => collect($event->message['recent_participants'] ?? null)->pluck('id')->all() === [$this->author->id]);
});

it('queues a broadcast the worker can run without an active organization', function () {
    Queue::fake();

    patchBroadcastEdit($this, 'changed');

    Queue::assertPushed(BroadcastEvent::class, fn ($job) => $job->event instanceof MessageUpdated);
    $job = unserialize(serialize(Queue::pushed(BroadcastEvent::class, fn ($job) => $job->event instanceof MessageUpdated)->first()));

    expect($job->event->broadcastWith()['message']['body'])->toBe('changed');
});
