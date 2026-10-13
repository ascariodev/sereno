<?php

use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Support\LogEventRecorder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

// Real concurrency needs committed data and two live connections, which RefreshDatabase's transaction cannot give.
// `conc_a` is the default connection (fixture and the first worker's receipt), `conc_b` is the second worker; the
// test removes everything it committed in `afterEach`.
beforeEach(function () {
    $this->originalDefault = config('database.default');
    $this->concOrganizations = [];
    foreach (['conc_a', 'conc_b'] as $name) {
        config(["database.connections.{$name}" => config("database.connections.{$this->originalDefault}")]);
    }
    DB::setDefaultConnection('conc_a');
});

afterEach(function () {
    DB::setDefaultConnection($this->originalDefault);

    try {
        $second = DB::connection('conc_b');
        while ($second->transactionLevel() > 0) {
            $second->rollBack();
        }
        $first = DB::connection('conc_a');
        while ($first->transactionLevel() > 0) {
            $first->rollBack();
        }
        $first->statement('RESET lock_timeout');
        $second->statement('RESET lock_timeout');
        $first->table('organizations')->whereIn('id', $this->concOrganizations)->delete();
    } finally {
        DB::purge('conc_a');
        DB::purge('conc_b');
    }
});

it('makes a second worker with the same event id wait for the first commit and then discard', function () {
    $organization = Organization::factory()->create();
    $this->concOrganizations[] = $organization->id;
    $source = LogSource::factory()->for(Project::factory()->for($organization))->create();
    $eventId = 'evt-concurrent-1';

    $first = DB::connection('conc_a');
    $first->beginTransaction();
    $first->table('log_event_receipts')->insert([
        'organization_id' => $source->organization_id,
        'log_source_id' => $source->id,
        'event_id' => $eventId,
        'received_at' => now('UTC')->format('Y-m-d H:i:s'),
    ]);

    DB::setDefaultConnection('conc_b');
    DB::statement("SET lock_timeout = '300ms'");
    try {
        app(LogEventRecorder::class)->record($source, ['level' => 'error', 'message' => 'Boom'], $eventId);
        $this->fail('The second worker should have waited for the first commit.');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('55P03');
    }
    DB::statement('RESET lock_timeout');

    $first->commit();

    expect(app(LogEventRecorder::class)->record($source, ['level' => 'error', 'message' => 'Boom'], $eventId))->toBeNull();

    DB::setDefaultConnection('conc_a');
    expect(DB::table('log_event_receipts')->where('log_source_id', $source->id)->count())->toBe(1)
        ->and(DB::table('log_groups')->where('project_id', $source->project_id)->count())->toBe(0)
        ->and(DB::table('log_events')->where('log_source_id', $source->id)->count())->toBe(0);
});
