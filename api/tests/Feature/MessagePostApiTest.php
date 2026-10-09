<?php

use App\Enums\Role;
use App\Events\MessageCreated;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    RateLimiter::clear('channel-messages');
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();

    $this->users = [];
    foreach (Role::cases() as $role) {
        $user = User::factory()->create();
        $this->organization->addMember($user, [$role]);
        $this->users[$role->value] = $user;
    }

    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
});

function postingAs(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

it('lets every role post a user message with the server-set kind and author', function () {
    foreach (Role::cases() as $role) {
        $user = $this->users[$role->value];

        postingAs($user, $this->organization)
            ->postJson("/api/channels/{$this->channel->id}/messages", [
                'body' => 'hello '.$role->value,
                'kind' => 'system',
                'user_id' => 999,
                'organization_id' => $this->other->id,
            ])
            ->assertCreated()
            ->assertJsonPath('data.kind', 'user')
            ->assertJsonPath('data.body', 'hello '.$role->value)
            ->assertJsonPath('data.user.id', $user->id);
    }

    $messages = Message::withoutGlobalScopes()->where('channel_id', $this->channel->id)->get();
    expect($messages)->toHaveCount(3)
        ->and($messages->pluck('kind')->unique()->all())->toBe(['user'])
        ->and($messages->pluck('organization_id')->unique()->all())->toBe([$this->organization->id]);
});

it('validates the body', function (mixed $body) {
    postingAs($this->users['member'], $this->organization)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => $body])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('body');

    expect(Message::withoutGlobalScopes()->count())->toBe(0);
})->with([
    'missing' => [null],
    'empty' => [''],
    'blank' => ['   '],
    'array' => [['x']],
    'too long' => [fn () => str_repeat('a', 4001)],
    'nul byte' => ["hi\u{0000}there"],
]);

it('accepts a body of exactly 4000 characters', function () {
    postingAs($this->users['member'], $this->organization)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => str_repeat('a', 4000)])
        ->assertCreated();
});

it('rejects posting to an archived channel', function () {
    $archived = Channel::factory()->for(Project::factory()->for($this->organization))->archived()->create();

    postingAs($this->users['member'], $this->organization)
        ->postJson("/api/channels/{$archived->id}/messages", ['body' => 'hi'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('channel');

    expect(Message::withoutGlobalScopes()->count())->toBe(0);
});

it('translates the archived channel error', function () {
    $archived = Channel::factory()->for(Project::factory()->for($this->organization))->archived()->create();

    postingAs($this->users['member'], $this->organization)
        ->withHeader('Accept-Language', 'es')
        ->postJson("/api/channels/{$archived->id}/messages", ['body' => 'hi'])
        ->assertJsonPath('errors.channel.0', 'El canal está archivado.');
});

it('hides channels of other organizations and requires membership', function () {
    postingAs($this->outsider, $this->other)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => 'hi'])
        ->assertNotFound();

    postingAs($this->outsider, $this->organization)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => 'hi'])
        ->assertForbidden();

    expect(Message::withoutGlobalScopes()->count())->toBe(0);
});

it('requires authentication', function () {
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => 'hi'])
        ->assertUnauthorized();
});

it('throttles per user with 429 and does not affect other users', function () {
    $limit = AppServiceProvider::CHANNEL_MESSAGES_PER_MINUTE;
    $url = "/api/channels/{$this->channel->id}/messages";

    for ($i = 0; $i < $limit; $i++) {
        postingAs($this->users['member'], $this->organization)->postJson($url, ['body' => 'x'])->assertCreated();
    }

    postingAs($this->users['member'], $this->organization)->postJson($url, ['body' => 'x'])
        ->assertStatus(429)
        ->assertHeader('Retry-After');

    postingAs($this->users['admin'], $this->organization)->postJson($url, ['body' => 'x'])->assertCreated();
});

function replyTo(object $test, Channel $channel, int|string $parentId, string $body = 'reply')
{
    return postingAs($test->users['member'], $test->organization)
        ->postJson("/api/channels/{$channel->id}/messages", ['body' => $body, 'parent_id' => $parentId]);
}

function systemRootIn(Channel $channel): int
{
    return DB::table('messages')->insertGetId([
        'organization_id' => $channel->organization_id,
        'channel_id' => $channel->id,
        'kind' => 'system',
        'payload' => '{"type":"log.new_group"}',
    ]);
}

it('replies to a user message and to a system notice, bumping the root counters', function () {
    $root = postingAs($this->users['admin'], $this->organization)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => 'root'])
        ->assertCreated()
        ->assertJsonPath('data.parent_id', null)
        ->assertJsonPath('data.replies_count', 0)
        ->json('data.id');
    $notice = systemRootIn($this->channel);

    replyTo($this, $this->channel, $root)->assertCreated()->assertJsonPath('data.parent_id', $root);
    replyTo($this, $this->channel, $root)->assertCreated();
    replyTo($this, $this->channel, $notice)->assertCreated()->assertJsonPath('data.parent_id', $notice);

    $rootRow = Message::withoutGlobalScopes()->find($root);
    $lastReply = Message::withoutGlobalScopes()->where('parent_id', $root)->latest('id')->first();
    expect($rootRow->replies_count)->toBe(2)
        ->and($rootRow->last_reply_at->equalTo($lastReply->created_at))->toBeTrue()
        ->and(Message::withoutGlobalScopes()->find($notice)->replies_count)->toBe(1);
});

it('does not move last_reply_at backwards when a reply is older than it', function () {
    $root = systemRootIn($this->channel);
    $later = now()->addHour()->startOfSecond();
    DB::table('messages')->where('id', $root)->update(['last_reply_at' => $later]);

    replyTo($this, $this->channel, $root)->assertCreated();

    $rootRow = Message::withoutGlobalScopes()->find($root);
    expect($rootRow->replies_count)->toBe(1)
        ->and($rootRow->last_reply_at->equalTo($later))->toBeTrue();
});

it('excludes replies from the main list', function () {
    $root = postingAs($this->users['admin'], $this->organization)
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => 'root'])->json('data.id');
    replyTo($this, $this->channel, $root)->assertCreated();

    postingAs($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$this->channel->id}/messages")
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $root)
        ->assertJsonPath('data.0.replies_count', 1);
});

it('rejects a parent from another channel, another organization, a reply or a missing one', function () {
    $otherChannel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $foreign = Channel::factory()->for(Project::factory()->for($this->other))->create();
    $inOtherChannel = systemRootIn($otherChannel);
    $inOtherOrg = systemRootIn($foreign);
    $root = systemRootIn($this->channel);
    $reply = replyTo($this, $this->channel, $root)->assertCreated()->json('data.id');

    replyTo($this, $this->channel, $inOtherChannel)->assertUnprocessable()->assertJsonValidationErrors('parent_id');
    replyTo($this, $this->channel, $inOtherOrg)->assertUnprocessable()->assertJsonValidationErrors('parent_id');
    replyTo($this, $this->channel, 999999)->assertUnprocessable()->assertJsonValidationErrors('parent_id');
    replyTo($this, $this->channel, 'abc')->assertUnprocessable()->assertJsonValidationErrors('parent_id');
    replyTo($this, $this->channel, $reply)
        ->assertUnprocessable()
        ->assertJsonPath('errors.parent_id.0', 'A reply cannot have replies.');

    expect(Message::withoutGlobalScopes()->where('parent_id', '!=', null)->count())->toBe(1)
        ->and(Message::withoutGlobalScopes()->find($root)->replies_count)->toBe(1);
});

it('translates the thread errors', function () {
    $root = systemRootIn($this->channel);
    $reply = replyTo($this, $this->channel, $root)->json('data.id');

    postingAs($this->users['member'], $this->organization)
        ->withHeader('Accept-Language', 'es')
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => 'x', 'parent_id' => $reply])
        ->assertJsonPath('errors.parent_id.0', 'Una respuesta no puede tener respuestas.');

    postingAs($this->users['member'], $this->organization)
        ->withHeader('Accept-Language', 'es')
        ->postJson("/api/channels/{$this->channel->id}/messages", ['body' => 'x', 'parent_id' => 999999])
        ->assertJsonPath('errors.parent_id.0', 'El mensaje al que responder no existe en este canal.');
});

it('broadcasts the reply with its parent_id', function () {
    Event::fake([MessageCreated::class]);
    $root = systemRootIn($this->channel);

    replyTo($this, $this->channel, $root)->assertCreated();

    Event::assertDispatched(MessageCreated::class, fn ($e) => $e->message['parent_id'] === $root
        && $e->channelId === $this->channel->id);
});
