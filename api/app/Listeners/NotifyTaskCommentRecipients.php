<?php

namespace App\Listeners;

use App\Events\TaskCommentCreated;
use App\Events\TaskCommentUpdated;
use App\Models\Task;
use App\Models\User;
use App\Notifications\TaskCommentedNotification;
use App\Notifications\TaskCommentMentionNotification;
use App\Notifications\TaskCommentNotification;
use App\Support\ProjectAccess;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Str;

/**
 * One try: a retry after notifying some recipients would notify them again (L-07). Each notification
 * revalidates in its own job (L-70).
 */
class NotifyTaskCommentRecipients implements ShouldQueue
{
    public int $tries = 1;

    private const EXCERPT_LIMIT = 140;

    public function handle(TaskCommentCreated $event): void
    {
        $this->process($event, null);
    }

    public function handleUpdated(TaskCommentUpdated $event): void
    {
        if ($event->addedMentionIds !== []) {
            $this->process($event, $event->addedMentionIds);
        }
    }

    /** @param  list<int>|null  $onlyMentionIds  On an edit: the new mentions, and nobody gets "commented". */
    private function process(TaskCommentCreated|TaskCommentUpdated $event, ?array $onlyMentionIds): void
    {
        $comment = $event->comment;
        $author = $comment['user'] ?? null;
        $task = Task::query()->withoutGlobalScopes()->with('project')->find($comment['task_id']);

        if ($author === null || $task === null || $task->project_id !== $event->projectId) {
            return;
        }

        $mentions = collect($comment['mentions'] ?? []);
        $mentionedIds = $mentions->pluck('id')->map(fn ($id) => (int) $id)->all();
        $commentedIds = collect($onlyMentionIds === null ? [$task->assignee_id, $task->created_by] : [])
            ->filter()
            ->unique()
            ->reject(fn (int $id) => $id === $author['id'] || in_array($id, $mentionedIds, true))
            ->values()
            ->all();

        $arguments = [
            $event->organizationId,
            $event->projectId,
            $task->id,
            $task->key(),
            Str::limit($task->title, 120, '...'),
            $comment['id'],
            $this->excerpt($comment['body'] ?? '', $mentions->pluck('name', 'id')->all()),
            $author['id'],
            $author['name'],
        ];

        $this->notify($onlyMentionIds === null ? $mentionedIds : array_values(array_intersect($mentionedIds, $onlyMentionIds)), new TaskCommentMentionNotification(...$arguments), $event);
        $this->notify($commentedIds, new TaskCommentedNotification(...$arguments), $event);
    }

    /** @param  list<int>  $userIds */
    private function notify(array $userIds, TaskCommentNotification $notification, TaskCommentCreated|TaskCommentUpdated $event): void
    {
        foreach (User::query()->whereIn('id', $userIds)->get() as $user) {
            if (ProjectAccess::canViewId($user, $event->organizationId, $event->projectId)) {
                $user->notify(clone $notification);
            }
        }
    }

    /** @param  array<int, string>  $names */
    private function excerpt(string $body, array $names): string
    {
        $text = preg_replace_callback('/<@([1-9][0-9]{0,17})>/', fn (array $m) => '@'.($names[(int) $m[1]] ?? ''), $body);

        return Str::limit(trim(preg_replace('/\s+/u', ' ', $text)), self::EXCERPT_LIMIT, '...');
    }
}
