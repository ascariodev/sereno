<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('log_sources', function (Blueprint $table) {
            $table->unique(['id', 'organization_id'], 'log_sources_id_organization_id_unique');
        });

        Schema::create('log_event_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('log_source_id');
            $table->string('event_id', 64);
            $table->timestamp('received_at')->useCurrent();

            $table->foreign(['log_source_id', 'organization_id'], 'log_event_receipts_source_organization_fk')
                ->references(['id', 'organization_id'])->on('log_sources')->cascadeOnDelete();
            $table->unique(['log_source_id', 'event_id']);
            $table->index('received_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('log_event_receipts');

        Schema::table('log_sources', function (Blueprint $table) {
            $table->dropUnique('log_sources_id_organization_id_unique');
        });
    }
};
