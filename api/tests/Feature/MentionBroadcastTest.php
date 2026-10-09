<?php

use App\Enums\Role;
use App\Events\MentionCreated;
use App\Models\Channel;
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
    $this->bob = User::factory()->create(['name' => 'Bob']);
    foreach ([$this->author, $this->ana, $this->bob] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->foreign = User::factory()->create();
    $this->other->addMember($this->foreign, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    Event::fake([MentionCreated::class]);
});

function postMentioning(object $test, string $body, ?int $parentId = null)
{
    Sanctum::actingAs($test->author);

    return test()->withHeader('X-Organization-Id', (string) $test->organization->id)
        ->postJson("/api/channels/{$test->channel->id}/messages", array_filter(
            ['body' => $body, 'parent_id' => $parentId],
            fn ($v) => $v !== null,
        ));
}

it('emits one mention.created per mentioned member on their private channel', function () {
    $id = postMentioning($this, "hi <@{$this->ana->id}> <@{$this->bob->id}> <@{$this->ana->id}>")->assertCreated()->json('data.id');

    Event::assertDispatchedTimes(MentionCreated::class, 2);
    foreach ([$this->ana, $this->bob] as $user) {
        Event::assertDispatched(MentionCreated::class, fn (MentionCreated $e) => $e->broadcastOn()->name === "private-users.{$user->id}"
            && $e->broadcastAs() === 'mention.created'
            && $e->broadcastWith()['organization_id'] === $this->organization->id
            && $e->broadcastWith()['channel_id'] === $this->channel->id
            && $e->broadcastWith()['parent_id'] === null
            && $e->broadcastWith()['message']['id'] === $id
            && $e->broadcastWith()['message']['user']['name'] === 'Author');
    }
});

it('carries the root id when the message is a reply', function () {
    $root = postMentioning($this, 'root')->json('data.id');

    postMentioning($this, "ping <@{$this->ana->id}>", $root)->assertCreated();

    Event::assertDispatched(MentionCreated::class, fn (MentionCreated $e) => $e->broadcastWith()['parent_id'] === $root
        && $e->broadcastWith()['message']['parent_id'] === $root);
});

it('does not emit for the author, non members, other organizations, unknown ids or plain messages', function () {
    postMentioning($this, "<@{$this->author->id}> <@{$this->foreign->id}> <@999999999> no mention")->assertCreated();
    postMentioning($this, 'nothing')->assertCreated();

    Event::assertNotDispatched(MentionCreated::class);
});

it('does not emit when the message is rejected', function () {
    postMentioning($this, str_repeat('x', 4001)." <@{$this->ana->id}>")->assertUnprocessable();

    Event::assertNotDispatched(MentionCreated::class);
});

it('does not emit when the transaction rolls back', function () {
    $root = postMentioning($this, 'root')->json('data.id');
    DB::listen(function ($query) {
        if (str_contains($query->sql, 'replies_count')) {
            throw new RuntimeException('boom');
        }
    });

    $this->withoutExceptionHandling();
    expect(fn () => postMentioning($this, "ping <@{$this->ana->id}>", $root))->toThrow(RuntimeException::class);

    Event::assertNotDispatched(MentionCreated::class);
});

it('does not leak more than the message payload to the mentioned user', function () {
    postMentioning($this, "hey <@{$this->ana->id}>")->assertCreated();

    Event::assertDispatched(MentionCreated::class, function (MentionCreated $e) {
        $payload = $e->broadcastWith();

        return array_keys($payload) === ['organization_id', 'channel_id', 'parent_id', 'message']
            && array_keys($payload['message']['user']) === ['id', 'name']
            && ! str_contains(json_encode($payload), 'email');
    });
});

it('survives queue serialization without an active organization', function () {
    postMentioning($this, "hey <@{$this->ana->id}>")->assertCreated();
    $event = Event::dispatched(MentionCreated::class)->first()[0];

    app(CurrentOrganization::class)->set(null);
    $restored = unserialize(serialize($event));

    expect($restored->broadcastOn()->name)->toBe($event->broadcastOn()->name)
        ->and($restored->broadcastAs())->toBe($event->broadcastAs())
        ->and($restored->broadcastWith())->toEqual($event->broadcastWith());
});
