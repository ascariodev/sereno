<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE messages ALTER COLUMN created_at TYPE timestamp(6), ALTER COLUMN last_reply_at TYPE timestamp(6)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE messages ALTER COLUMN created_at TYPE timestamp(0), ALTER COLUMN last_reply_at TYPE timestamp(0)');
    }
};
