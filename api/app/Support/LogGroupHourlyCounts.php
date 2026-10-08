<?php

namespace App\Support;

use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\Project;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

class LogGroupHourlyCounts
{
    public const HOURS = 24;

    /**
     * Counts the events received per UTC hour in the last 24 hours (the current one included, still
     * incomplete) for the given groups of the project. Ids of other projects or missing are omitted.
     *
     * @param  list<int>  $groupIds
     * @return array{from: CarbonImmutable, hours: int, counts: array<int, list<int>>}
     */
    public static function for(Project $project, array $groupIds, CarbonInterface $now): array
    {
        $from = CarbonImmutable::instance($now)->utc()->startOfHour()->subHours(self::HOURS - 1);
        $to = $from->addHours(self::HOURS);

        $ids = LogGroup::query()
            ->where('project_id', $project->id)
            ->whereIn('id', $groupIds)
            ->orderBy('id')
            ->pluck('id')
            ->all();

        $counts = array_fill_keys($ids, array_fill(0, self::HOURS, 0));

        if ($ids === []) {
            return ['from' => $from, 'hours' => self::HOURS, 'counts' => $counts];
        }

        $rows = LogEvent::query()
            ->toBase()
            ->selectRaw("log_group_id, date_trunc('hour', received_at) AS hour, count(*) AS total")
            ->whereIn('log_group_id', $ids)
            ->where('received_at', '>=', $from)
            ->where('received_at', '<', $to)
            ->groupBy('log_group_id', 'hour')
            ->get();

        foreach ($rows as $row) {
            $hour = CarbonImmutable::parse($row->hour, 'UTC');
            $index = intdiv($hour->getTimestamp() - $from->getTimestamp(), 3600);
            $counts[$row->log_group_id][$index] = (int) $row->total;
        }

        return ['from' => $from, 'hours' => self::HOURS, 'counts' => $counts];
    }
}
