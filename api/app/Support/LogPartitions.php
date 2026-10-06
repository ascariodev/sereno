<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use LogicException;

class LogPartitions
{
    public const PARENT_TABLE = 'log_events';

    private const LOCK_KEY = 'log_events_partitions';

    public static function nameFor(CarbonInterface $day): string
    {
        return self::PARENT_TABLE.'_'.self::startOfDay($day)->format('Ymd');
    }

    public static function exists(CarbonInterface $day): bool
    {
        return DB::scalar('SELECT to_regclass(?) IS NOT NULL', [self::nameFor($day)]);
    }

    /**
     * Creates the daily partition that holds rows received on $day (UTC) if it is missing.
     *
     * The advisory lock serializes concurrent callers: IF NOT EXISTS alone can still fail with a
     * duplicate catalog entry when two sessions create the same partition at the same time.
     */
    public static function ensure(CarbonInterface $day): string
    {
        $name = self::nameFor($day);

        if (self::exists($day)) {
            return $name;
        }

        $from = self::startOfDay($day);
        $to = $from->addDay();

        if (preg_match('/^'.self::PARENT_TABLE.'_\d{8}$/', $name) !== 1) {
            throw new LogicException('Invalid log partition name.');
        }

        DB::transaction(function () use ($name, $from, $to) {
            DB::statement('SELECT pg_advisory_xact_lock(hashtext(?))', [self::LOCK_KEY]);

            DB::statement(sprintf(
                "CREATE TABLE IF NOT EXISTS %s PARTITION OF %s FOR VALUES FROM ('%s') TO ('%s')",
                $name,
                self::PARENT_TABLE,
                $from->format('Y-m-d H:i:s'),
                $to->format('Y-m-d H:i:s'),
            ));
        });

        return $name;
    }

    private static function startOfDay(CarbonInterface $day): CarbonImmutable
    {
        return CarbonImmutable::instance($day)->utc()->startOfDay();
    }
}
