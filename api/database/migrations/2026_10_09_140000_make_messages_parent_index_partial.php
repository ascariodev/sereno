<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP INDEX IF EXISTS messages_parent_id_id_index');
        DB::statement('CREATE INDEX messages_parent_id_id_index ON messages (parent_id, id DESC) WHERE parent_id IS NOT NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS messages_parent_id_id_index');
        DB::statement('CREATE INDEX messages_parent_id_id_index ON messages (parent_id, id DESC)');
    }
};
