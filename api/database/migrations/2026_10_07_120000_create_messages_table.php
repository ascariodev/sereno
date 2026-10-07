<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('channel_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('kind', 10);
            $table->text('body')->nullable();
            $table->jsonb('payload')->nullable();
            $table->foreignId('log_group_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('created_at')->useCurrent();
        });

        DB::statement("ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('user', 'system'))");
        DB::statement('CREATE INDEX messages_channel_id_id_index ON messages (channel_id, id DESC)');
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
