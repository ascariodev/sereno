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
});

function listDeletedMessage(Channel $channel, ?int $userId = null, ?int $parentId = null, bool $deleted = false): int
{
    $id = DB::table('messages')->insertGetId([
        'organization_id' => $channel->organization_id,
        'channel_id' => $channel->id,
        'kind' => 'user',
        'body' => $deleted ? null : 'text',
        'user_id' => $userId,
        'parent_id' => $parentId,
        'deleted_at' => $deleted ? now() : null,
    ]);
    if ($parentId !== null && ! $deleted) {
        DB::table('messages')->where('id', $parentId)->increment('replies_count');
    }

    return $id;
}

function listDeletedGet(string $path = '')
{
    Sanctum::actingAs(test()->member);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->getJson('/api/channels/'.test()->channel->id.'/messages'.$path);
}

it('omits deleted roots without replies and keeps deleted roots that still have replies', function () {
    $live = listDeletedMessage($this->channel);
    $gone = listDeletedMessage($this->channel, deleted: true);
    $marker = listDeletedMessage($this->channel, deleted: true);
    listDeletedMessage($this->channel, $this->member->id, $marker);

    $data = listDeletedGet()->assertOk()->json('data');

    expect(collect($data)->pluck('id')->all())->toBe([$marker, $live])->not->toContain($gone)
        ->and($data[0]['deleted_at'])->not->toBeNull()
        ->and($data[0]['body'])->toBeNull();
});

it('omits deleted replies and still serves the replies of a deleted root', function () {
    $root = listDeletedMessage($this->channel, deleted: true);
    $kept = listDeletedMessage($this->channel, $this->member->id, $root);
    listDeletedMessage($this->channel, $this->member->id, $root, deleted: true);

    $response = listDeletedGet("/{$root}/replies")->assertOk();

    expect(collect($response->json('data'))->pluck('id')->all())->toBe([$kept])
        ->and($response->json('meta.root.id'))->toBe($root)
        ->and($response->json('meta.root.deleted_at'))->not->toBeNull();
});

it('ignores deleted replies when loading thread participants', function () {
    [$a, $b] = User::factory()->count(2)->create();
    $root = listDeletedMessage($this->channel);
    listDeletedMessage($this->channel, $a->id, $root);
    listDeletedMessage($this->channel, $b->id, $root, deleted: true);

    $participants = listDeletedGet()->assertOk()->json('data.0.recent_participants');

    expect(collect($participants)->pluck('id')->all())->toBe([$a->id]);
});
