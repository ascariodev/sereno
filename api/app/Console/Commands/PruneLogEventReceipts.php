<?php

namespace App\Console\Commands;

use App\Models\LogEventReceipt;
use App\Models\Scopes\OrganizationScope;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('log:prune-receipts')]
#[Description('Delete event receipts older than the ingest retry window')]
class PruneLogEventReceipts extends Command
{
    public const BATCH_SIZE = 5000;

    public function handle(): int
    {
        $cutoff = now()->subHours(LogEventReceipt::RETRY_WINDOW_HOURS);
        $deleted = 0;

        do {
            $ids = LogEventReceipt::query()
                ->withoutGlobalScope(OrganizationScope::class)
                ->where('received_at', '<', $cutoff)
                ->limit(self::BATCH_SIZE)
                ->pluck('id');

            $deleted += LogEventReceipt::query()
                ->withoutGlobalScope(OrganizationScope::class)
                ->whereIn('id', $ids)
                ->delete();
        } while ($ids->count() === self::BATCH_SIZE);

        $this->components->info(sprintf('Deleted %d event receipts.', $deleted));

        return self::SUCCESS;
    }
}
