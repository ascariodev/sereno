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

function participantsMessage(Channel $channel, ?int $userId = null, ?int $parentId = null): int
{
    $id = DB::table('messages')->insertGetId([
        'organization_id' => $channel->organization_id,
        'channel_id' => $channel->id,
        'kind' => 'user',
        'body' => 'text',
        'user_id' => $userId,
        'parent_id' => $parentId,
    ]);
    if ($parentId !== null) {
        DB::table('messages')->where('id', $parentId)->increment('replies_count');
    }

    return $id;
}

function participantsList(?int $root = null)
{
    Sanctum::actingAs(test()->member);
    $path = $root === null ? '' : "/{$root}/replies";

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->getJson('/api/channels/'.test()->channel->id."/messages{$path}");
}

it('lists the latest distinct reply authors of each root, newest first and capped at three', function () {
    [$a, $b, $c, $d] = User::factory()->count(4)->create();
    $root = participantsMessage($this->channel);
    $quiet = participantsMessage($this->channel);
    foreach ([$a, $b, $a, $c, $d, $c] as $user) {
        participantsMessage($this->channel, $user->id, $root);
    }
    participantsMessage($this->channel, null, $root);

    $data = participantsList()->assertOk()->json('data');
    $byId = collect($data)->keyBy('id');

    expect(collect($byId[$root]['recent_participants'])->pluck('id')->all())->toBe([$c->id, $d->id, $a->id])
        ->and($byId[$root]['recent_participants'][0])->toBe(['id' => $c->id, 'name' => $c->name])
        ->and($byId[$quiet]['recent_participants'])->toBe([]);
});

it('carries the participants in meta.root of the replies endpoint', function () {
    $a = User::factory()->create();
    $root = participantsMessage($this->channel);
    participantsMessage($this->channel, $a->id, $root);

    participantsList($root)->assertOk()
        ->assertJsonPath('meta.root.recent_participants', [['id' => $a->id, 'name' => $a->name]]);
});

it('does not expose participants to a user outside the organization', function () {
    $a = User::factory()->create();
    $root = participantsMessage($this->channel);
    participantsMessage($this->channel, $a->id, $root);
    $outsider = User::factory()->create();
    Organization::factory()->create()->addMember($outsider, [Role::Owner]);

    Sanctum::actingAs($outsider);
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->getJson("/api/channels/{$this->channel->id}/messages")
        ->assertForbidden();
});
