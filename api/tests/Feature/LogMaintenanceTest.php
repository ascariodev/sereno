<?php

use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Support\CurrentOrganization;
use App\Support\LogPartitions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->travelTo(now()->utc()->setTime(3, 0));
    $this->organization = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
    config(['workspace.log.retention_days' => 30]);
});

function partitionNames(): array
{
    return array_keys(LogPartitions::all());
}

it('drops partitions past the retention and keeps the rest', function () {
    $today = now()->utc()->startOfDay();
    foreach ([40, 32, 31, 30, 29, 1] as $daysAgo) {
        LogPartitions::ensure($today->copy()->subDays($daysAgo));
    }

    $this->artisan('log:maintain')->assertSuccessful();

    $partitions = partitionNames();

    expect($partitions)->not->toBeEmpty();

    foreach ([40, 32, 31] as $daysAgo) {
        expect($partitions)->not->toContain(LogPartitions::nameFor($today->copy()->subDays($daysAgo)));
    }

    foreach ([30, 29, 1] as $daysAgo) {
        expect($partitions)->toContain(LogPartitions::nameFor($today->copy()->subDays($daysAgo)));
    }

    foreach (range(0, 7) as $offset) {
        expect($partitions)->toContain(LogPartitions::nameFor($today->copy()->addDays($offset)));
    }
});

it('creates missing partitions up to seven days ahead', function () {
    $this->travelTo(now()->addDays(20));

    $this->artisan('log:maintain')
        ->expectsOutputToContain('Created 8 partitions')
        ->assertSuccessful();

    foreach (range(0, 7) as $offset) {
        expect(LogPartitions::exists(now()->addDays($offset)))->toBeTrue();
    }
});

it('deletes groups last seen before the cutoff only', function () {
    $cutoff = now()->utc()->startOfDay()->subDays(30);
    $old = LogGroup::factory()->for($this->project)->create(['last_seen_at' => $cutoff->copy()->subSecond()]);
    $boundary = LogGroup::factory()->for($this->project)->create(['last_seen_at' => $cutoff]);
    $recent = LogGroup::factory()->for($this->project)->create(['last_seen_at' => now()]);
    $foreignOld = LogGroup::factory()
        ->for(Project::factory()->for(Organization::factory()))
        ->create(['last_seen_at' => $cutoff->copy()->subDays(5)]);

    $this->artisan('log:maintain')
        ->expectsOutputToContain('deleted 2 groups')
        ->assertSuccessful();

    $remaining = DB::table('log_groups')->pluck('id')->all();

    expect($remaining)->toContain($boundary->id, $recent->id)
        ->not->toContain($old->id)
        ->not->toContain($foreignOld->id);
});

it('is idempotent', function () {
    LogPartitions::ensure(now()->subDays(45));

    $this->artisan('log:maintain')->assertSuccessful();
    $after = partitionNames();

    $this->artisan('log:maintain')
        ->expectsOutputToContain('Created 0 partitions, dropped 0 partitions, deleted 0 groups.')
        ->assertSuccessful();

    expect(partitionNames())->toBe($after);
});

it('refuses to drop anything with an invalid retention', function (mixed $retention) {
    config(['workspace.log.retention_days' => $retention]);
    $old = LogPartitions::ensure(now()->subDays(90));
    $group = LogGroup::factory()->for($this->project)->create(['last_seen_at' => now()->subDays(90)]);

    $this->artisan('log:maintain')->assertFailed();

    expect(partitionNames())->toContain($old, LogPartitions::nameFor(now()), LogPartitions::nameFor(now()->addDays(7)))
        ->and(DB::table('log_groups')->where('id', $group->id)->exists())->toBeTrue();
})->with([0, -3, '30']);

it('ignores tables that do not follow the partition naming', function () {
    DB::statement("CREATE TABLE log_events_legacy PARTITION OF log_events FOR VALUES FROM ('2000-01-01') TO ('2000-01-02')");

    $this->artisan('log:maintain')->assertSuccessful();

    expect(DB::scalar("SELECT to_regclass('log_events_legacy') IS NOT NULL"))->toBeTrue()
        ->and(partitionNames())->not->toContain('log_events_legacy');
});

it('schedules log maintenance and failed jobs pruning', function () {
    Artisan::call('schedule:list');
    $output = Artisan::output();

    expect($output)->toContain('log:maintain')
        ->toContain('queue:prune-failed --hours=168');
});
