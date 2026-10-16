<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['tasks', 'task_comments'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->string('source', 16)->nullable();
            });

            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_source_check CHECK (source IN ('mcp'))");
        }
    }

    public function down(): void
    {
        foreach (['tasks', 'task_comments'] as $table) {
            DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$table}_source_check");

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropColumn('source');
            });
        }
    }
};
