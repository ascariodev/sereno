<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    RateLimiter::clear('mentions');
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->ana = User::factory()->create(['name' => 'Ana']);
    $this->bob = User::factory()->create(['name' => 'Bob']);
    $this->author = User::factory()->create(['name' => 'Author']);
    foreach ([$this->ana, $this->bob, $this->author] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->other->addMember($this->ana, [Role::Member]);
    $this->outsider = User::factory()->create();
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create(['name' => 'ops']);
    $this->otherChannel = Channel::factory()->for(Project::factory()->for($this->other))->create();
});

function inboxMention(Channel $channel, User $user, ?int $parentId = null, bool $read = false): int
{
    $messageId = DB::table('messages')->insertGetId([
        'organization_id' => $channel->organization_id,
        'channel_id' => $channel->id,
        'user_id' => test()->author->id,
        'kind' => 'user',
        'body' => "hi <@{$user->id}>",
        'parent_id' => $parentId,
    ]);

    return DB::table('message_mentions')->insertGetId([
        'organization_id' => $channel->organization_id,
        'message_id' => $messageId,
        'user_id' => $user->id,
        'read_at' => $read ? now() : null,
    ]);
}

function inboxCall(?User $user, ?Organization $organization, string $method, string $uri, array $data = [])
{
    if ($user) {
        Sanctum::actingAs($user);
    }
    $test = $organization ? test()->withHeader('X-Organization-Id', (string) $organization->id) : test();

    return $test->json($method, $uri, $data);
}

function inboxUnread(User $user, Organization $organization): int
{
    return DB::table('message_mentions')->where('user_id', $user->id)
        ->where('organization_id', $organization->id)->whereNull('read_at')->count();
}

it('lists own mentions of the active organization newest first with the full shape', function () {
    $first = inboxMention($this->channel, $this->ana, read: true);
    $root = DB::table('messages')->where('channel_id', $this->channel->id)->value('id');
    $second = inboxMention($this->channel, $this->ana, $root);
    inboxMention($this->channel, $this->bob);
    inboxMention($this->otherChannel, $this->ana);

    $response = inboxCall($this->ana, $this->organization, 'GET', '/api/mentions')
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $second)
        ->assertJsonPath('data.1.id', $first)
        ->assertJsonPath('data.0.read_at', null)
        ->assertJsonPath('data.0.parent_id', $root)
        ->assertJsonPath('data.1.parent_id', null)
        ->assertJsonPath('data.0.channel', ['id' => $this->channel->id, 'name' => 'ops', 'project_id' => $this->channel->project_id])
        ->assertJsonPath('data.0.message.user.name', 'Author')
        ->assertJsonPath('data.0.message.mentions', [['id' => $this->ana->id, 'name' => 'Ana']])
        ->assertJsonPath('meta.unread_count', 1)
        ->assertJsonStructure(['data' => [['id', 'read_at', 'created_at', 'message' => ['id', 'body', 'channel_id'], 'channel', 'parent_id']], 'links', 'meta' => ['next_cursor', 'unread_count']]);

    expect($response->json('data.1.read_at'))->not->toBeNull();
});

it('scopes the unread count to the active organization', function () {
    inboxMention($this->channel, $this->ana);
    inboxMention($this->otherChannel, $this->ana);
    inboxMention($this->otherChannel, $this->ana);

    inboxCall($this->ana, $this->other, 'GET', '/api/mentions')
        ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.unread_count', 2);
});

it('paginates with a cursor and validates the query', function () {
    $ids = collect(range(1, 3))->map(fn () => inboxMention($this->channel, $this->ana));

    $page = inboxCall($this->ana, $this->organization, 'GET', '/api/mentions?per_page=2')
        ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.unread_count', 3);
    $cursor = $page->json('meta.next_cursor');
    expect($cursor)->not->toBeNull();

    inboxCall($this->ana, $this->organization, 'GET', '/api/mentions?per_page=2&cursor='.urlencode($cursor))
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $ids[0])->assertJsonPath('meta.next_cursor', null);

    inboxCall($this->ana, $this->organization, 'GET', '/api/mentions?cursor=garbage')
        ->assertUnprocessable()->assertJsonValidationErrors('cursor');
    inboxCall($this->ana, $this->organization, 'GET', '/api/mentions?per_page=101')
        ->assertUnprocessable()->assertJsonValidationErrors('per_page');
});

it('does not run extra queries per mention', function () {
    foreach (range(1, 2) as $i) {
        inboxMention($this->channel, $this->ana);
    }
    Sanctum::actingAs($this->ana);
    $count = function () {
        DB::flushQueryLog();
        DB::enableQueryLog();
        test()->withHeader('X-Organization-Id', (string) $this->organization->id)->getJson('/api/mentions')->assertOk();

        return count(DB::getQueryLog());
    };
    $count(); // warm-up: the first call also touches the token
    $few = $count();
    foreach (range(1, 6) as $i) {
        inboxMention($this->channel, $this->ana);
    }

    expect($count())->toBe($few);
});

it('requires authentication, an organization and membership', function () {
    inboxMention($this->channel, $this->ana);

    $this->getJson('/api/mentions')->assertUnauthorized();
    inboxCall($this->ana, null, 'GET', '/api/mentions')->assertStatus(400);
    inboxCall($this->outsider, $this->organization, 'GET', '/api/mentions')->assertForbidden();
    inboxCall($this->outsider, $this->organization, 'POST', '/api/mentions/read', ['all' => true])->assertForbidden();
});

it('marks only the given own mentions as read and returns the new unread count', function () {
    $a = inboxMention($this->channel, $this->ana);
    $b = inboxMention($this->channel, $this->ana);
    $bobs = inboxMention($this->channel, $this->bob);
    $elsewhere = inboxMention($this->otherChannel, $this->ana);

    inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read', ['ids' => [$a, $bobs, $elsewhere, 999999]])
        ->assertOk()->assertExactJson(['unread_count' => 1]);

    expect(DB::table('message_mentions')->whereIn('id', [$a])->whereNotNull('read_at')->count())->toBe(1)
        ->and(DB::table('message_mentions')->whereIn('id', [$b, $bobs, $elsewhere])->whereNotNull('read_at')->count())->toBe(0);
});

it('marks all own mentions of the active organization as read and is idempotent', function () {
    inboxMention($this->channel, $this->ana);
    inboxMention($this->channel, $this->ana);
    $bobs = inboxMention($this->channel, $this->bob);
    inboxMention($this->otherChannel, $this->ana);

    inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read', ['all' => true])
        ->assertOk()->assertExactJson(['unread_count' => 0]);
    $stamp = DB::table('message_mentions')->where('user_id', $this->ana->id)->where('organization_id', $this->organization->id)->value('read_at');

    $this->travel(5)->minutes();
    inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read', ['all' => true])
        ->assertOk()->assertExactJson(['unread_count' => 0]);

    expect(DB::table('message_mentions')->where('user_id', $this->ana->id)->where('organization_id', $this->organization->id)->value('read_at'))->toBe($stamp)
        ->and(inboxUnread($this->ana, $this->other))->toBe(1)
        ->and(DB::table('message_mentions')->where('id', $bobs)->value('read_at'))->toBeNull();
});

it('validates the read payload with translated messages', function () {
    inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read')
        ->assertUnprocessable()->assertJsonValidationErrors('ids');
    inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read', ['all' => false])
        ->assertUnprocessable()->assertJsonValidationErrors('ids');
    inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read', ['ids' => 'x'])
        ->assertUnprocessable()->assertJsonValidationErrors('ids');
    inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read', ['ids' => [0]])
        ->assertUnprocessable()->assertJsonValidationErrors('ids.0');
    inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read', ['ids' => range(1, 101)])
        ->assertUnprocessable()->assertJsonValidationErrors('ids');
    inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read', ['all' => 'maybe'])
        ->assertUnprocessable()->assertJsonValidationErrors('all');

    $en = inboxCall($this->ana, $this->organization, 'POST', '/api/mentions/read')->json('errors.ids.0');
    $es = $this->withHeader('Accept-Language', 'es')->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->postJson('/api/mentions/read')->json('errors.ids.0');
    expect($es)->not->toBe($en);
});

it('throttles the inbox per user', function () {
    foreach (range(1, 60) as $i) {
        inboxCall($this->ana, $this->organization, 'GET', '/api/mentions')->assertOk();
    }

    inboxCall($this->ana, $this->organization, 'GET', '/api/mentions')->assertTooManyRequests();
    inboxCall($this->bob, $this->organization, 'GET', '/api/mentions')->assertOk();
});
