<?php

use App\Chat\MessageDeletion;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

// Real concurrency needs committed data and two live connections, which RefreshDatabase's transaction cannot give.
// So the test switches the default connection to an unwrapped one (`conc_a`, the deleter), uses `conc_b` as the
// replier, and removes everything it committed in `afterEach`.
beforeEach(function () {
    $this->originalDefault = config('database.default');
    $this->concCreated = ['orgs' => [], 'users' => []];
    foreach (['conc_a', 'conc_b'] as $name) {
        config(["database.connections.{$name}" => config("database.connections.{$this->originalDefault}")]);
    }
    DB::setDefaultConnection('conc_a');
});

afterEach(function () {
    DB::setDefaultConnection($this->originalDefault);

    try {
        $replier = DB::connection('conc_b');
        if ($replier->transactionLevel() > 0) {
            $replier->rollBack();
        }
        $deleter = DB::connection('conc_a');
        while ($deleter->transactionLevel() > 0) {
            $deleter->rollBack();
        }
        $deleter->statement('RESET lock_timeout');
        $deleter->table('organizations')->whereIn('id', $this->concCreated['orgs'])->delete();
        $deleter->table('users')->whereIn('id', $this->concCreated['users'])->delete();
    } finally {
        DB::purge('conc_a');
        DB::purge('conc_b');
    }
});
function concurrencyFixture(object $test): array
{
    $organization = Organization::factory()->create();
    $user = User::factory()->create();
    $test->concCreated['orgs'][] = $organization->id;
    $test->concCreated['users'][] = $user->id;
    app(CurrentOrganization::class)->set($organization);

    $channel = Channel::factory()->for(Project::factory()->for($organization))->create();
    $root = Message::factory()->for($channel)->create(['kind' => Message::KIND_USER, 'user_id' => $user->id, 'body' => 'root']);
    $old = Message::factory()->for($channel)->create(['kind' => Message::KIND_USER, 'user_id' => $user->id, 'body' => 'old']);
    $old->parent_id = $root->id;
    $old->save();
    $root->forceFill(['replies_count' => 1, 'last_reply_at' => $old->created_at])->save();

    return [$channel, $root, $old, $user];
}

function concurrencyInsertReply(Channel $channel, Message $root, User $user): object
{
    $now = now()->addMinutes(5);
    $id = DB::connection('conc_b')->table('messages')->insertGetId([
        'organization_id' => $channel->organization_id,
        'channel_id' => $channel->id,
        'user_id' => $user->id,
        'kind' => Message::KIND_USER,
        'body' => 'new',
        'parent_id' => $root->id,
        'created_at' => $now,
    ]);

    return (object) ['id' => $id, 'created_at' => $now];
}

function concurrencyCountReply(Message $root, object $reply): void
{
    DB::connection('conc_b')->table('messages')->where('id', $root->id)->update([
        'replies_count' => DB::raw('replies_count + 1'),
        'last_reply_at' => DB::raw('GREATEST(last_reply_at, '.DB::connection('conc_b')->getPdo()->quote($reply->created_at->format('Y-m-d H:i:s')).'::timestamp)'),
    ]);
}

it('makes the delete wait for a reply being inserted or counted on another connection', function () {
    [$channel, $root, $old, $user] = concurrencyFixture($this);
    $replier = DB::connection('conc_b');

    $replier->beginTransaction();
    $reply = concurrencyInsertReply($channel, $root, $user);

    // Just inserted, not counted: the reply's FK check holds a key-share lock on the root, which the delete's
    // FOR UPDATE waits for, so the delete never sees a half-counted reply. The same after the counter UPDATE.
    DB::statement("SET lock_timeout = '300ms'");
    foreach ([false, true] as $counted) {
        if ($counted) {
            concurrencyCountReply($root, $reply);
        }
        try {
            app(MessageDeletion::class)->delete($old);
            $this->fail('The delete should have waited for the reply.');
        } catch (QueryException $e) {
            expect($e->getCode())->toBe('55P03');
        }
        expect(DB::table('messages')->where('id', $old->id)->value('deleted_at'))->toBeNull();
    }
    DB::statement('RESET lock_timeout');

    $replier->commit();
    expect(app(MessageDeletion::class)->delete($old))->not->toBeNull();

    $row = DB::table('messages')->where('id', $root->id)->first();
    expect($row->replies_count)->toBe(1)
        ->and(Carbon::parse($row->last_reply_at)->format('Y-m-d H:i:s'))->toBe($reply->created_at->format('Y-m-d H:i:s'));
});
