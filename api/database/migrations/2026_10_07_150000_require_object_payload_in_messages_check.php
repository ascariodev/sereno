<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE messages DROP CONSTRAINT messages_body_payload_check,
            ADD CONSTRAINT messages_body_payload_check CHECK (
                (kind = 'user' AND body IS NOT NULL)
                OR (kind = 'system' AND payload IS NOT NULL AND jsonb_typeof(payload) = 'object' AND body IS NULL)
            )
            SQL);
    }

    public function down(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE messages DROP CONSTRAINT messages_body_payload_check,
            ADD CONSTRAINT messages_body_payload_check CHECK (
                (kind = 'user' AND body IS NOT NULL)
                OR (kind = 'system' AND payload IS NOT NULL AND body IS NULL)
            )
            SQL);
    }
};
