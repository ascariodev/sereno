<?php

namespace App\Actions;

use App\Enums\NotificationType;
use App\Models\AppNotification;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\TaskCommentMention;
use App\Models\User;
use App\Support\MentionTargets;

class SyncTaskCommentMentions
{
    /**
     * Only syncs the mention rows; notifications are sent by the NotifyTaskCommentRecipients listener. `$currentIds` skips the lookup (new comment: []).
     *
     * A removed mention also drops its notification, as the chat does. Returns the ids of the newly mentioned users.
     *
     * @param  list<int>|null  $currentIds
     * @return list<int>
     */
    public function __invoke(TaskComment $comment, Task $task, int $authorId, ?array $currentIds = null): array
    {
        $targets = MentionTargets::resolve(
            $comment->body,
            $authorId,
            $comment->organization_id,
            $task->project_id,
            config('chat.mentions.max_per_message'),
        );

        $currentIds ??= TaskCommentMention::query()
            ->where('task_comment_id', $comment->id)
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $removed = array_values(array_diff($currentIds, $targets->pluck('id')->all()));
        $added = $targets->reject(fn (User $user) => in_array($user->id, $currentIds, true));

        if ($removed !== []) {
            TaskCommentMention::query()
                ->where('task_comment_id', $comment->id)
                ->whereIn('user_id', $removed)
                ->delete();
            AppNotification::query()
                ->withoutGlobalScopes()
                ->where('organization_id', $comment->organization_id)
                ->where('type', NotificationType::TaskCommentMention->value)
                ->where('subject_type', TaskComment::class)
                ->where('subject_id', $comment->id)
                ->whereIn('user_id', $removed)
                ->delete();
        }

        if ($added->isEmpty()) {
            return [];
        }

        $now = now();
        TaskCommentMention::query()->insert($added->map(fn (User $user) => [
            'organization_id' => $comment->organization_id,
            'task_comment_id' => $comment->id,
            'user_id' => $user->id,
            'created_at' => $now,
        ])->values()->all());

        return $added->pluck('id')->map(fn ($id) => (int) $id)->values()->all();
    }
}
