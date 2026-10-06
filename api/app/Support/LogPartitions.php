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

    private const NAME_PATTERN = '/^'.self::PARENT_TABLE.'_(\d{8})\z/';

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

        self::assertValidName($name);

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

    /**
     * Creates the partitions for $from and the following $days days.
     *
     * @return list<string> names of the partitions that were missing
     */
    public static function ensureRange(CarbonInterface $from, int $days): array
    {
        $created = [];

        foreach (range(0, $days) as $offset) {
            $day = self::startOfDay($from)->addDays($offset);

            if (! self::exists($day)) {
                $created[] = self::ensure($day);
            }
        }

        return $created;
    }

    /**
     * Lists the attached daily partitions read from the catalog, keyed by name.
     * Tables whose name does not match the daily pattern are ignored.
     *
     * @return array<string, CarbonImmutable> partition name => UTC day it holds
     */
    public static function all(): array
    {
        $names = DB::table('pg_inherits')
            ->join('pg_class as child', 'child.oid', '=', 'pg_inherits.inhrelid')
            ->join('pg_class as parent', 'parent.oid', '=', 'pg_inherits.inhparent')
            ->join('pg_namespace as parent_namespace', 'parent_namespace.oid', '=', 'parent.relnamespace')
            ->where('parent.relname', self::PARENT_TABLE)
            ->whereRaw('parent_namespace.nspname = current_schema()')
            ->orderBy('child.relname')
            ->pluck('child.relname');

        $partitions = [];

        foreach ($names as $name) {
            $day = self::dayFromName($name);

            if ($day !== null) {
                $partitions[$name] = $day;
            }
        }

        return $partitions;
    }

    /**
     * Drops the partitions whose whole range ends on or before $cutoff (start of its UTC day).
     *
     * @return list<string> names of the dropped partitions
     */
    public static function dropBefore(CarbonInterface $cutoff): array
    {
        $cutoffDay = self::startOfDay($cutoff);
        $dropped = [];

        foreach (self::all() as $name => $day) {
            if ($day->addDay()->greaterThan($cutoffDay)) {
                continue;
            }

            self::assertValidName($name);

            DB::transaction(function () use ($name) {
                DB::statement("SET LOCAL lock_timeout = '10s'");
                DB::statement('SELECT pg_advisory_xact_lock(hashtext(?))', [self::LOCK_KEY]);
                DB::statement(sprintf('DROP TABLE IF EXISTS %s', $name));
            });

            $dropped[] = $name;
        }

        return $dropped;
    }

    private static function dayFromName(string $name): ?CarbonImmutable
    {
        if (preg_match(self::NAME_PATTERN, $name, $matches) !== 1) {
            return null;
        }

        $day = CarbonImmutable::createFromFormat('!Ymd', $matches[1], 'UTC');

        return $day !== false && $day->format('Ymd') === $matches[1] ? $day : null;
    }

    private static function assertValidName(string $name): void
    {
        if (preg_match(self::NAME_PATTERN, $name) !== 1) {
            throw new LogicException('Invalid log partition name.');
        }
    }

    private static function startOfDay(CarbonInterface $day): CarbonImmutable
    {
        return CarbonImmutable::instance($day)->utc()->startOfDay();
    }
}
