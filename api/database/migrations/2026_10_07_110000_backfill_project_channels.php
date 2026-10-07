<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            INSERT INTO channels (organization_id, project_id, name, created_at, updated_at)
            SELECT p.organization_id, p.id, p.key, NOW(), NOW()
            FROM projects p
            ON CONFLICT (organization_id, project_id) DO NOTHING
            SQL);
    }

    public function down(): void {}
};
