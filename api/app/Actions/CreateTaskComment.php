<?php

namespace App\Actions;

use App\Events\TaskCommentCreated;
use App\Http\Controllers\Api\TaskCommentController;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\TaskCommentAttachment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CreateTaskComment
{
    public function __construct(private readonly SyncTaskCommentMentions $syncMentions) {}

    /** @param  list<int>  $attachmentIds */
    public function __invoke(Task $task, User $author, string $body, array $attachmentIds = []): TaskComment
    {
        $comment = $task->comments()->make(['body' => $body]);
        $comment->user_id = $author->id;

        DB::transaction(function () use ($comment, $task, $author, $attachmentIds) {
            $comment->save();
            ($this->syncMentions)($comment, $task, $author->id, []);
            $this->linkAttachments($comment, $attachmentIds, $author->id);
        });

        $comment->load(TaskCommentController::RELATIONS);
        TaskCommentCreated::dispatch($comment, $task->project_id);

        return $comment;
    }

    /**
     * Takes the attachments only if they are still free: another comment sent at the same time may have taken
     * them after validation, and then the whole comment is rolled back.
     *
     * @param  list<int>  $ids
     */
    private function linkAttachments(TaskComment $comment, array $ids, int $authorId): void
    {
        if ($ids === []) {
            return;
        }

        $owned = fn () => TaskCommentAttachment::query()
            ->whereIn('id', $ids)
            ->where('task_id', $comment->task_id)
            ->where('user_id', $authorId);

        $owned()->orderBy('id')->lockForUpdate()->pluck('id');

        $linked = $owned()->whereNull('task_comment_id')->update(['task_comment_id' => $comment->id]);

        if ($linked !== count($ids)) {
            throw ValidationException::withMessages([
                'attachment_ids' => __('The attachments do not exist or are already in use.'),
            ]);
        }
    }
}
