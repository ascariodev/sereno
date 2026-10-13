<?php

namespace App\Notifications;

use App\Enums\NotificationType;
use App\Models\TaskCommentMention;
use App\Models\User;
use App\Support\MailMarkdown;

class TaskCommentMentionNotification extends TaskCommentNotification
{
    protected function type(): NotificationType
    {
        return NotificationType::TaskCommentMention;
    }

    protected function stillRelevant(User $notifiable): bool
    {
        return $this->stillApplies($notifiable);
    }

    public function stillApplies(User $notifiable): bool
    {
        return TaskCommentMention::query()
            ->withoutGlobalScopes()
            ->where('task_comment_id', $this->commentId)
            ->where('user_id', $notifiable->id)
            ->sharedLock()
            ->exists();
    }

    protected function mailSubject(): string
    {
        return __(':actor mentioned you in :task', ['actor' => $this->actorName, 'task' => $this->taskKey]);
    }

    protected function mailLine(): string
    {
        return __(':actor mentioned you in a comment on :task: :excerpt', [
            'actor' => MailMarkdown::escape($this->actorName),
            'task' => $this->taskKey,
            'excerpt' => MailMarkdown::escape($this->excerpt),
        ]);
    }
}
