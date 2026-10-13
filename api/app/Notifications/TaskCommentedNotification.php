<?php

namespace App\Notifications;

use App\Enums\NotificationType;
use App\Models\TaskComment;
use App\Models\User;
use App\Notifications\Contracts\RevalidatesAfterInsert;
use App\Support\MailMarkdown;
use App\Support\ProjectAccess;

class TaskCommentedNotification extends TaskCommentNotification implements RevalidatesAfterInsert
{
    protected function type(): NotificationType
    {
        return NotificationType::TaskCommented;
    }

    protected function stillRelevant(User $notifiable): bool
    {
        return $this->stillApplies($notifiable);
    }

    public function stillApplies(User $notifiable): bool
    {
        return TaskComment::query()->withoutGlobalScopes()->whereKey($this->commentId)->sharedLock()->exists()
            && $this->isAssigneeOrCreator($notifiable, lock: true)
            && ProjectAccess::canViewId($notifiable, $this->organizationId, $this->projectId, lock: true);
    }

    protected function mailSubject(): string
    {
        return __(':actor commented on :task', ['actor' => $this->actorName, 'task' => $this->taskKey]);
    }

    protected function mailLine(): string
    {
        return __(':actor commented on your task :task: :excerpt', [
            'actor' => MailMarkdown::escape($this->actorName),
            'task' => $this->taskKey,
            'excerpt' => MailMarkdown::escape($this->excerpt),
        ]);
    }
}
