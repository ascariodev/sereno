<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Providers\AppServiceProvider;
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
