<?php

use App\Chat\MessageMentions;
use App\Events\MentionCreated;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->message = Message::factory()->for($this->channel)->create();
    [$this->ana, $this->bob, $this->cy] = User::factory()->count(3)->create()->all();
    $this->mentions = new MessageMentions;
});

it('diffs the target against the current ids', function () {
    $diff = $this->mentions->diff(new Collection([$this->ana, $this->bob]), [$this->bob->id, $this->cy->id]);

    expect($diff['added']->pluck('id')->all())->toBe([$this->ana->id])
        ->and($diff['removed'])->toBe([$this->cy->id]);
});

it('diffs to nothing when target and current match, and removes all for an empty target', function () {
    $same = $this->mentions->diff(new Collection([$this->ana]), [$this->ana->id]);
    $empty = $this->mentions->diff(new Collection, [$this->ana->id, $this->bob->id]);

    expect($same['added'])->toBeEmpty()->and($same['removed'])->toBe([])
        ->and($empty['added'])->toBeEmpty()->and($empty['removed'])->toBe([$this->ana->id, $this->bob->id]);
});

it('sync deletes the removed rows, keeps the rest and notifies only the added', function () {
    foreach ([$this->ana, $this->bob] as $user) {
        DB::table('message_mentions')->insert([
            'organization_id' => $this->organization->id, 'message_id' => $this->message->id,
            'user_id' => $user->id, 'created_at' => now(),
        ]);
    }
    Event::fake([MentionCreated::class]);

    $changes = $this->mentions->sync($this->message, new Collection([$this->bob, $this->cy]));

    expect($changes['removed'])->toBe([$this->ana->id])
        ->and($changes['added']->pluck('id')->all())->toBe([$this->cy->id])
        ->and(DB::table('message_mentions')->where('message_id', $this->message->id)->orderBy('user_id')->pluck('user_id')->all())
        ->toBe([$this->bob->id, $this->cy->id]);
    Event::assertDispatchedTimes(MentionCreated::class, 1);
});

it('sync leaves other messages mentions alone', function () {
    $other = Message::factory()->for($this->channel)->create();
    DB::table('message_mentions')->insert([
        'organization_id' => $this->organization->id, 'message_id' => $other->id,
        'user_id' => $this->ana->id, 'created_at' => now(),
    ]);
    DB::table('message_mentions')->insert([
        'organization_id' => $this->organization->id, 'message_id' => $this->message->id,
        'user_id' => $this->ana->id, 'created_at' => now(),
    ]);

    $this->mentions->sync($this->message, new Collection);

    expect(DB::table('message_mentions')->where('message_id', $other->id)->count())->toBe(1)
        ->and(DB::table('message_mentions')->where('message_id', $this->message->id)->count())->toBe(0);
});
