<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();

    assignMembersToAllProjects();
});

function aroundRoot(Channel $channel, ?int $userId = null, bool $deleted = false): int
{
    return DB::table('messages')->insertGetId([
        'organization_id' => $channel->organization_id,
        'channel_id' => $channel->id,
        'kind' => 'user',
        'body' => $deleted ? null : 'text',
        'user_id' => $userId,
        'deleted_at' => $deleted ? now() : null,
    ]);
}

function aroundGet(Channel $channel, string $query)
{
    Sanctum::actingAs(test()->member);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->getJson('/api/channels/'.$channel->id.'/messages'.$query);
}

it('loads a window around the given root and continues towards older roots with next_cursor', function () {
    $ids = collect(range(1, 12))->map(fn () => aroundRoot($this->channel, $this->member->id))->all();

    $first = aroundGet($this->channel, "?around={$ids[5]}&per_page=6")->assertOk();

    expect($first->json('data.*.id'))->toBe([$ids[7], $ids[6], $ids[5], $ids[4], $ids[3], $ids[2]])
        ->and($first->json('meta.next_cursor'))->not->toBeNull()
        ->and($first->json('meta.has_newer'))->toBeTrue();

    $second = aroundGet($this->channel, '?per_page=6&cursor='.$first->json('meta.next_cursor'))->assertOk();
    expect($second->json('data.*.id'))->toBe([$ids[1], $ids[0]])
        ->and($second->json('meta.next_cursor'))->toBeNull();
});

it('has no next_cursor when the window reaches the oldest root, and skips deleted roots without replies', function () {
    $a = aroundRoot($this->channel, $this->member->id);
    aroundRoot($this->channel, $this->member->id, deleted: true);
    $b = aroundRoot($this->channel, $this->member->id);

    $response = aroundGet($this->channel, "?around={$a}")->assertOk();

    expect($response->json('data.*.id'))->toBe([$b, $a])
        ->and($response->json('meta.next_cursor'))->toBeNull()
        ->and($response->json('meta.has_newer'))->toBeFalse();
    expect(aroundGet($this->channel, '')->json('meta'))->not->toHaveKey('has_newer');
});

it('ignores around when a cursor is sent and rejects invalid values', function () {
    $ids = collect(range(1, 4))->map(fn () => aroundRoot($this->channel, $this->member->id))->all();
    $cursor = aroundGet($this->channel, '?per_page=2')->json('meta.next_cursor');

    aroundGet($this->channel, "?per_page=2&cursor={$cursor}&around={$ids[3]}")
        ->assertOk()
        ->assertJsonPath('data.0.id', $ids[1]);

    aroundGet($this->channel, '?around=abc')->assertUnprocessable()->assertJsonValidationErrors('around');
    aroundGet($this->channel, '?around=0')->assertUnprocessable()->assertJsonValidationErrors('around');
});

it('never returns roots from other channels or organizations when around points at them', function () {
    $mine = aroundRoot($this->channel, $this->member->id);
    $otherChannel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $inOtherChannel = aroundRoot($otherChannel);
    $foreign = Channel::factory()->for(Project::factory()->for(Organization::factory()->create()))->create();
    $inForeign = aroundRoot($foreign);

    expect(aroundGet($this->channel, "?around={$inOtherChannel}")->assertOk()->json('data.*.id'))->toBe([$mine])
        ->and(aroundGet($this->channel, "?around={$inForeign}")->assertOk()->json('data.*.id'))->toBe([$mine]);

    aroundGet($foreign, "?around={$mine}")->assertNotFound();
});
