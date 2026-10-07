<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            UPDATE channels
            SET archived_at = p.archived_at
            FROM projects p
            WHERE p.id = channels.project_id
              AND p.archived_at IS NOT NULL
              AND channels.archived_at IS NULL
            SQL);
    }

    public function down(): void {}
};
