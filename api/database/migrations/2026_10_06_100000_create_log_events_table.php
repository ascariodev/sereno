<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const INITIAL_PARTITION_DAYS = 8;

    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE TABLE log_events (
                id bigint GENERATED ALWAYS AS IDENTITY,
                organization_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
                project_id bigint NOT NULL,
                log_group_id bigint NOT NULL REFERENCES log_groups (id) ON DELETE CASCADE,
                log_source_id bigint NULL REFERENCES log_sources (id) ON DELETE SET NULL,
                level varchar(16) NOT NULL,
                message text NOT NULL,
                context jsonb NULL,
                occurred_at timestamp(0) without time zone NOT NULL,
                received_at timestamp(0) without time zone NOT NULL,
                PRIMARY KEY (id, received_at),
                CONSTRAINT log_events_level_check CHECK (level IN ('debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'))
            ) PARTITION BY RANGE (received_at)
            SQL);

        DB::statement('CREATE INDEX log_events_log_group_id_received_at_index ON log_events (log_group_id, received_at DESC)');

        $today = Carbon::now('UTC')->startOfDay();

        for ($offset = 0; $offset < self::INITIAL_PARTITION_DAYS; $offset++) {
            $day = $today->copy()->addDays($offset);

            DB::statement(sprintf(
                "CREATE TABLE IF NOT EXISTS log_events_%s PARTITION OF log_events FOR VALUES FROM ('%s') TO ('%s')",
                $day->format('Ymd'),
                $day->format('Y-m-d H:i:s'),
                $day->copy()->addDay()->format('Y-m-d H:i:s'),
            ));
        }
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS log_events');
    }
};
