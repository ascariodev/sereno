<?php

use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    $this->source = LogSource::factory()->for($this->project)->create();
});

function insertReceipt(int $organizationId, int $sourceId, string $eventId): void
{
    DB::table('log_event_receipts')->insert([
        'organization_id' => $organizationId,
        'log_source_id' => $sourceId,
        'event_id' => $eventId,
    ]);
}

it('rejects a second receipt with the same source and event id', function () {
    insertReceipt($this->organization->id, $this->source->id, 'evt-1');

    expect(fn () => insertReceipt($this->organization->id, $this->source->id, 'evt-1'))
        ->toThrow(QueryException::class, 'log_event_receipts_log_source_id_event_id_unique');
});

it('accepts the same event id for a different source', function () {
    $other = LogSource::factory()->for($this->project)->create();

    insertReceipt($this->organization->id, $this->source->id, 'evt-1');
    insertReceipt($this->organization->id, $other->id, 'evt-1');

    expect(DB::table('log_event_receipts')->count())->toBe(2);
});

it('rejects a receipt whose organization is not the source organization', function () {
    $foreign = Organization::factory()->create();

    expect(fn () => insertReceipt($foreign->id, $this->source->id, 'evt-1'))
        ->toThrow(QueryException::class, 'log_event_receipts_source_organization_fk');
});

it('deletes the receipts when the source is deleted', function () {
    insertReceipt($this->organization->id, $this->source->id, 'evt-1');

    $this->source->delete();

    expect(DB::table('log_event_receipts')->count())->toBe(0);
});
