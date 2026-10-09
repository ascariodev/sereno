<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('message_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('channel_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('message_id')->nullable();
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('disk', 30);
            $table->string('path', 255);
            $table->string('original_name', 255);
            $table->string('mime', 127);
            $table->unsignedBigInteger('size');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign(['channel_id', 'message_id'], 'message_attachments_message_fk')
                ->references(['channel_id', 'id'])->on('messages')->cascadeOnDelete();
            $table->index('message_id');
        });

        DB::statement('CREATE INDEX message_attachments_orphans_index ON message_attachments (created_at) WHERE message_id IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('message_attachments');
    }
};
