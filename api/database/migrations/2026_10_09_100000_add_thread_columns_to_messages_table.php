<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->unsignedBigInteger('parent_id')->nullable();
            $table->unsignedInteger('replies_count')->default(0);
            $table->timestamp('last_reply_at')->nullable();
            $table->unique(['channel_id', 'id'], 'messages_channel_id_id_unique');
        });

        DB::statement('ALTER TABLE messages ADD CONSTRAINT messages_parent_fk FOREIGN KEY (channel_id, parent_id) REFERENCES messages (channel_id, id) ON DELETE CASCADE');
        DB::statement('CREATE INDEX messages_parent_id_id_index ON messages (parent_id, id DESC)');
        DB::statement('CREATE INDEX messages_channel_id_id_root_index ON messages (channel_id, id DESC) WHERE parent_id IS NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS messages_channel_id_id_root_index');
        DB::statement('DROP INDEX IF EXISTS messages_parent_id_id_index');
        DB::statement('ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_parent_fk');

        Schema::table('messages', function (Blueprint $table) {
            $table->dropUnique('messages_channel_id_id_unique');
            $table->dropColumn(['parent_id', 'replies_count', 'last_reply_at']);
        });
    }
};
