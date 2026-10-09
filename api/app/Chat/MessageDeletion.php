<?php

namespace App\Chat;

use App\Models\Message;
use App\Models\MessageAttachment;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

class MessageDeletion
{
    public function __construct(private MessageMentions $mentions) {}

    /**
     * Soft deletes the message: sets `deleted_at`, empties the body and removes its mentions and attachment rows
     * (files go after the commit; `chat:prune-attachments` catches any left behind). A reply takes one off its
     * root's `replies_count` and recomputes `last_reply_at` from the live replies.
     *
     * Returns null if the message was already deleted (a concurrent request won).
     *
     * @return array{message: Message, root: Message|null, removed_mentions: list<int>}|null
     */
    public function delete(Message $message): ?array
    {
        return DB::transaction(function () use ($message) {
            // Root first, as a reply sent at the same time locks it with its counter UPDATE: the order is the same
            // and the recount below runs in a new statement, after any reply committed while waiting.
            $root = $message->parent_id === null
                ? null
                : Message::query()->whereKey($message->parent_id)->lockForUpdate()->first();

            $locked = Message::query()->whereKey($message->id)->whereNull('deleted_at')->lockForUpdate()->first();
            if ($locked === null) {
                return null;
            }

            $removed = $this->mentions->sync($locked, new Collection)['removed'];

            $files = MessageAttachment::query()->where('message_id', $locked->id)->get(['id', 'disk', 'path']);
            MessageAttachment::query()->whereIn('id', $files->pluck('id'))->delete();

            $locked->body = null;
            $locked->deleted_at = now();
            $locked->save();

            if ($root !== null) {
                // A decrement, not a recount: a reply inserted but not yet counted (or not visible) is added by
                // its own `+ 1`, and its GREATEST on last_reply_at fixes the max taken here.
                $root->replies_count = max(0, $root->replies_count - 1);
                $root->last_reply_at = Message::query()
                    ->where('parent_id', $root->id)
                    ->whereNull('deleted_at')
                    ->max('created_at');
                $root->save();
            }

            DB::afterCommit(function () use ($files) {
                foreach ($files as $file) {
                    try {
                        Storage::disk($file->disk)->delete($file->path);
                    } catch (Throwable $e) {
                        report($e);
                    }
                }
            });

            return ['message' => $locked, 'root' => $root, 'removed_mentions' => $removed];
        });
    }
}
