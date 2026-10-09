<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A user message may come without body when it has attachments. A CHECK cannot look at
 * message_attachments and the attachments are linked after the insert, so the rule lives in
 * deferred constraint triggers that read the committed state of the message.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE messages DROP CONSTRAINT messages_body_payload_check,
            ADD CONSTRAINT messages_body_payload_check CHECK (
                kind = 'user'
                OR (kind = 'system' AND payload IS NOT NULL AND jsonb_typeof(payload) = 'object' AND body IS NULL)
            )
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION messages_require_body_or_attachments() RETURNS trigger
            LANGUAGE plpgsql
            SET search_path = public
            AS $$
            DECLARE
                target bigint;
            BEGIN
                IF TG_TABLE_NAME = 'messages' THEN
                    target := NEW.id;
                ELSE
                    target := OLD.message_id;
                END IF;

                IF target IS NOT NULL AND EXISTS (
                    SELECT 1 FROM messages m
                    WHERE m.id = target AND m.kind = 'user' AND m.body IS NULL
                        AND NOT EXISTS (SELECT 1 FROM message_attachments a WHERE a.message_id = m.id)
                ) THEN
                    RAISE EXCEPTION 'messages_body_or_attachments: user message % has neither body nor attachments', target
                        USING ERRCODE = 'check_violation';
                END IF;

                RETURN NULL;
            END;
            $$;

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

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER message_attachments_keep_message_content ON message_attachments;
            DROP TRIGGER messages_body_or_attachments ON messages;
            DROP FUNCTION messages_require_body_or_attachments();
            SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE messages DROP CONSTRAINT messages_body_payload_check,
            ADD CONSTRAINT messages_body_payload_check CHECK (
                (kind = 'user' AND body IS NOT NULL)
                OR (kind = 'system' AND payload IS NOT NULL AND jsonb_typeof(payload) = 'object' AND body IS NULL)
            )
            SQL);
    }
};
