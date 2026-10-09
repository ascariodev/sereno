<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Only queue the deferred check when it can fail: a system message or a message with body never
 * needs it, nor an attachment that was not linked yet. Postgres cannot add WHEN with ALTER TRIGGER.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER messages_body_or_attachments ON messages;
            DROP TRIGGER message_attachments_keep_message_content ON message_attachments;

            CREATE CONSTRAINT TRIGGER messages_body_or_attachments
                AFTER INSERT OR UPDATE OF body ON messages
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW
                WHEN (NEW.kind = 'user' AND NEW.body IS NULL)
                EXECUTE FUNCTION messages_require_body_or_attachments();

            CREATE CONSTRAINT TRIGGER message_attachments_keep_message_content
                AFTER UPDATE OF message_id OR DELETE ON message_attachments
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW
                WHEN (OLD.message_id IS NOT NULL)
                EXECUTE FUNCTION messages_require_body_or_attachments();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER messages_body_or_attachments ON messages;
            DROP TRIGGER message_attachments_keep_message_content ON message_attachments;

            CREATE CONSTRAINT TRIGGER messages_body_or_attachments
                AFTER INSERT OR UPDATE OF body ON messages
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messages_require_body_or_attachments();

            CREATE CONSTRAINT TRIGGER message_attachments_keep_message_content
                AFTER UPDATE OF message_id OR DELETE ON message_attachments
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messages_require_body_or_attachments();
            SQL);
    }
};
