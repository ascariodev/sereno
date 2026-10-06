<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('log_groups', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->string('fingerprint', 64);
            $table->string('level', 16);
            $table->string('title', 255);
            $table->string('status', 16)->default('open');
            $table->timestamp('first_seen_at');
            $table->timestamp('last_seen_at');
            $table->bigInteger('events_count')->default(0);
            $table->timestamps();

            $table->unique(['project_id', 'fingerprint']);
            $table->index(['project_id', 'last_seen_at']);
            $table->index(['project_id', 'status', 'last_seen_at']);
            $table->index('organization_id');
        });

        DB::statement("ALTER TABLE log_groups ADD CONSTRAINT log_groups_level_check CHECK (level IN ('debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'))");
        DB::statement("ALTER TABLE log_groups ADD CONSTRAINT log_groups_status_check CHECK (status IN ('open', 'resolved', 'ignored'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('log_groups');
    }
};
