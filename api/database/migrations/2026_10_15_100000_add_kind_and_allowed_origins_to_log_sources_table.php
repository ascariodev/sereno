<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('log_sources', function (Blueprint $table) {
            $table->string('kind', 16)->default('server');
            $table->jsonb('allowed_origins')->nullable();
        });

        DB::statement("ALTER TABLE log_sources ADD CONSTRAINT log_sources_kind_check CHECK (kind IN ('server', 'browser'))");
        DB::statement(<<<'SQL'
            ALTER TABLE log_sources ADD CONSTRAINT log_sources_allowed_origins_check CHECK (
                (kind = 'server' AND allowed_origins IS NULL)
                OR (kind = 'browser' AND CASE WHEN jsonb_typeof(allowed_origins) = 'array' THEN jsonb_array_length(allowed_origins) > 0 ELSE false END)
            )
            SQL);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE log_sources DROP CONSTRAINT IF EXISTS log_sources_allowed_origins_check');
        DB::statement('ALTER TABLE log_sources DROP CONSTRAINT IF EXISTS log_sources_kind_check');

        Schema::table('log_sources', function (Blueprint $table) {
            $table->dropColumn(['kind', 'allowed_origins']);
        });
    }
};
