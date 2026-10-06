<?php

namespace App\Console\Commands;

use App\Models\LogGroup;
use App\Support\LogPartitions;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('log:maintain')]
#[Description('Create upcoming log partitions and drop the ones past the retention period')]
class MaintainLogPartitions extends Command
{
    public const DAYS_AHEAD = 7;

    public const MIN_RETENTION_DAYS = 1;

    public function handle(): int
    {
        $today = now()->utc()->startOfDay();

        $created = LogPartitions::ensureRange($today, self::DAYS_AHEAD);

        $retentionDays = config('workspace.log.retention_days');

        if (! is_int($retentionDays) || $retentionDays < self::MIN_RETENTION_DAYS) {
            $this->components->error(sprintf(
                'Created %d partitions. Nothing dropped: log retention must be at least %d day.',
                count($created),
                self::MIN_RETENTION_DAYS,
            ));

            return self::FAILURE;
        }

        $cutoff = $today->copy()->subDays($retentionDays);

        $dropped = LogPartitions::dropBefore($cutoff);

        $deletedGroups = LogGroup::withoutGlobalScopes()->where('last_seen_at', '<', $cutoff)->delete();

        $this->components->info(sprintf(
            'Created %d partitions, dropped %d partitions, deleted %d groups.',
            count($created),
            count($dropped),
            $deletedGroups,
        ));

        return self::SUCCESS;
    }
}
