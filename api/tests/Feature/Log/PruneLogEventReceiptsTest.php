<?php

use App\Console\Commands\PruneLogEventReceipts;
use App\Models\LogEventReceipt;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $organization = Organization::factory()->create();
    $project = Project::factory()->for($organization)->create();
    $this->source = LogSource::factory()->for($project)->create();
    $this->organizationId = $organization->id;
});

function pruneReceiptsInsert(object $test, string $eventId, string $receivedAt): void
{
    DB::table('log_event_receipts')->insert([
        'organization_id' => $test->organizationId,
        'log_source_id' => $test->source->id,
        'event_id' => $eventId,
        'received_at' => $receivedAt,
    ]);
}

it('deletes receipts past the retry window and keeps the recent ones', function () {
    $window = LogEventReceipt::RETRY_WINDOW_HOURS;

    pruneReceiptsInsert($this, 'old', now()->subHours($window)->subMinute()->toDateTimeString());
    pruneReceiptsInsert($this, 'older', now()->subDays(10)->toDateTimeString());
    pruneReceiptsInsert($this, 'edge', now()->subHours($window)->addMinute()->toDateTimeString());
    pruneReceiptsInsert($this, 'new', now()->toDateTimeString());

    $this->artisan('log:prune-receipts')->assertSuccessful();

    expect(DB::table('log_event_receipts')->orderBy('event_id')->pluck('event_id')->all())->toBe(['edge', 'new']);
});

it('deletes receipts in several batches', function () {
    $rows = collect(range(1, PruneLogEventReceipts::BATCH_SIZE + 3))->map(fn (int $i) => [
        'organization_id' => $this->organizationId,
        'log_source_id' => $this->source->id,
        'event_id' => "old-$i",
        'received_at' => now()->subDays(5)->toDateTimeString(),
    ]);
    $rows->chunk(1000)->each(fn ($chunk) => DB::table('log_event_receipts')->insert($chunk->all()));
    pruneReceiptsInsert($this, 'new', now()->toDateTimeString());

    $this->artisan('log:prune-receipts')->assertSuccessful();

    expect(DB::table('log_event_receipts')->pluck('event_id')->all())->toBe(['new']);
});
