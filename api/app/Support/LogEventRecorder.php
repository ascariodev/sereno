<?php

namespace App\Support;

use App\Enums\LogLevel;
use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\LogSource;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class LogEventRecorder
{
    /**
     * Groups and stores one already validated event. Tenant ids come from the source, never from
     * the active organization: ingestion runs in jobs where the active organization is not set.
     *
     * @param  array{level: LogLevel|string, message: string, context?: array<mixed>|null, occurred_at?: CarbonInterface|string|null, fingerprint?: string|null}  $event
     */
    public function record(LogSource $source, array $event): LogEvent
    {
        $receivedAt = CarbonImmutable::now('UTC')->startOfSecond();
        $level = $event['level'] instanceof LogLevel ? $event['level'] : LogLevel::from($event['level']);
        $message = $event['message'];
        $occurredAt = isset($event['occurred_at'])
            ? Carbon::parse($event['occurred_at'])->utc()
            : $receivedAt;

        // The same $receivedAt decides the partition and the row: around midnight, computing it twice could pick different days.
        LogPartitions::ensure($receivedAt);

        return DB::transaction(function () use ($source, $event, $level, $message, $occurredAt, $receivedAt) {
            $groupId = $this->upsertGroup(
                $source,
                LogFingerprint::for($message, $event['fingerprint'] ?? null),
                $level,
                self::titleFrom($message),
                $receivedAt,
            );

            $logEvent = new LogEvent;
            $logEvent->forceFill([
                'organization_id' => $source->organization_id,
                'project_id' => $source->project_id,
                'log_group_id' => $groupId,
                'log_source_id' => $source->id,
                'level' => $level,
                'message' => $message,
                'context' => $event['context'] ?? null,
                'occurred_at' => $occurredAt,
                'received_at' => $receivedAt,
            ])->save();

            return $logEvent;
        });
    }

    public static function titleFrom(string $message): string
    {
        $firstLine = strtok(ltrim($message), "\r\n");

        return mb_substr(trim($firstLine === false ? '' : $firstLine), 0, LogGroup::TITLE_MAX_LENGTH);
    }

    /**
     * Atomic under concurrency: the unique (project_id, fingerprint) index arbitrates, so two
     * workers with the same new fingerprint end up in one group with both events counted.
     */
    private function upsertGroup(LogSource $source, string $fingerprint, LogLevel $level, string $title, CarbonInterface $seenAt): int
    {
        $timestamp = $seenAt->format('Y-m-d H:i:s');

        $sql = sprintf(<<<'SQL'
            INSERT INTO log_groups (organization_id, project_id, fingerprint, level, title, first_seen_at, last_seen_at, events_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT (project_id, fingerprint) DO UPDATE SET %s
            RETURNING id
            SQL, implode(', ', $this->conflictAssignments()));

        return (int) DB::selectOne($sql, [
            $source->organization_id,
            $source->project_id,
            $fingerprint,
            $level->value,
            $title,
            $timestamp,
            $timestamp,
            $timestamp,
            $timestamp,
        ])->id;
    }

    /**
     * What a new event changes in an existing group. Status transitions (reopening a resolved
     * group) belong here too.
     *
     * @return list<string>
     */
    private function conflictAssignments(): array
    {
        $severity = self::severitySql('log_groups.level');
        $incomingSeverity = self::severitySql('EXCLUDED.level');

        return [
            'events_count = log_groups.events_count + 1',
            'last_seen_at = GREATEST(log_groups.last_seen_at, EXCLUDED.last_seen_at)',
            "level = CASE WHEN {$incomingSeverity} > {$severity} THEN EXCLUDED.level ELSE log_groups.level END",
            'updated_at = EXCLUDED.updated_at',
        ];
    }

    /**
     * Position of the level in an array literal ordered by LogLevel::severity(); the literals come
     * from the enum, never from input.
     */
    private static function severitySql(string $column): string
    {
        $levels = LogLevel::cases();
        usort($levels, fn (LogLevel $a, LogLevel $b) => $a->severity() <=> $b->severity());

        $literals = implode(', ', array_map(fn (LogLevel $level) => "'{$level->value}'", $levels));

        return "array_position(ARRAY[{$literals}]::text[], {$column}::text)";
    }
}
