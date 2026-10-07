<?php

use App\Enums\Role;
use App\Events\MessageCreated;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Broadcasting\BroadcastEvent;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->user = User::factory()->create(['name' => 'Ana']);
    $this->organization->addMember($this->user, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
});

it('broadcasts a posted message on the private channel with the message resource', function () {
    Event::fake([MessageCreated::class]);
    Sanctum::actingAs($this->user);

    $id = $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => 'hola'])
        ->assertCreated()
        ->json('data.id');

    Event::assertDispatchedTimes(MessageCreated::class, 1);
    Event::assertDispatched(MessageCreated::class, function (MessageCreated $event) use ($id) {
        $payload = $event->broadcastWith()['message'];

        return $event->broadcastOn()->name === "private-organizations.{$this->organization->id}.channels.{$this->channel->id}"
            && $event->broadcastAs() === 'message.created'
            && $payload['id'] === $id
            && $payload['kind'] === 'user'
            && $payload['body'] === 'hola'
            && $payload['user'] === ['id' => $this->user->id, 'name' => 'Ana'];
    });
});

it('broadcasts system messages with a null user', function () {
    Event::fake([MessageCreated::class]);
    app(CurrentOrganization::class)->set($this->organization);

    Message::factory()->for($this->channel)->system(['type' => 'log.group_opened'])->create();

    Event::assertDispatched(MessageCreated::class, fn (MessageCreated $event) => $event->message['kind'] === 'system'
        && $event->message['user'] === null
        && $event->message['payload'] === ['type' => 'log.group_opened']);
});

it('does not broadcast a message whose transaction rolls back', function () {
    $dispatched = 0;
    Event::listen(MessageCreated::class, function () use (&$dispatched) {
        $dispatched++;
    });
    app(CurrentOrganization::class)->set($this->organization);

    DB::beginTransaction();
    Message::factory()->for($this->channel)->create();
    expect($dispatched)->toBe(0);
    DB::rollBack();

    expect($dispatched)->toBe(0);

    DB::transaction(fn () => Message::factory()->for($this->channel)->create());

    expect($dispatched)->toBe(1);
});

it('queues a broadcast the worker can run without an active organization', function () {
    Queue::fake();
    app(CurrentOrganization::class)->set($this->organization);
    $message = Message::factory()->for($this->channel)->create(['body' => 'hola']);

    Queue::assertPushed(BroadcastEvent::class, 1);
    $job = unserialize(serialize(Queue::pushed(BroadcastEvent::class)->first()));
    app(CurrentOrganization::class)->set(null);

    expect($job->event)->toBeInstanceOf(MessageCreated::class)
        ->and($job->event->broadcastWith()['message']['id'])->toBe($message->id)
        ->and($job->event->broadcastWith()['message']['body'])->toBe('hola');
});
