<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A deleted message keeps its row (soft delete) with no body and no attachments, so the content
 * rule skips it. The trigger also watches deleted_at so clearing it cannot bring back an empty message.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->timestamp('edited_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

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
                    WHERE m.id = target AND m.kind = 'user' AND m.body IS NULL AND m.deleted_at IS NULL
                        AND NOT EXISTS (SELECT 1 FROM message_attachments a WHERE a.message_id = m.id)
                ) THEN
                    RAISE EXCEPTION 'messages_body_or_attachments: user message % has neither body nor attachments', target
                        USING ERRCODE = 'check_violation';
                END IF;

                RETURN NULL;
            END;
            $$;

            DROP TRIGGER messages_body_or_attachments ON messages;

            CREATE CONSTRAINT TRIGGER messages_body_or_attachments
                AFTER INSERT OR UPDATE OF body, deleted_at ON messages
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW
                WHEN (NEW.kind = 'user' AND NEW.body IS NULL AND NEW.deleted_at IS NULL)
                EXECUTE FUNCTION messages_require_body_or_attachments();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER messages_body_or_attachments ON messages;

            CREATE CONSTRAINT TRIGGER messages_body_or_attachments
                AFTER INSERT OR UPDATE OF body ON messages
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW
                WHEN (NEW.kind = 'user' AND NEW.body IS NULL)
                EXECUTE FUNCTION messages_require_body_or_attachments();

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
            SQL);

        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn(['edited_at', 'deleted_at']);
        });
    }
};
