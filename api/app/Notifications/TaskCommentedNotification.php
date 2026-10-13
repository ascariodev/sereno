<?php

namespace App\Notifications;

use App\Enums\NotificationType;
use App\Models\User;
use App\Support\MailMarkdown;

class TaskCommentedNotification extends TaskCommentNotification
{
    protected function type(): NotificationType
    {
        return NotificationType::TaskCommented;
    }

    protected function stillRelevant(User $notifiable): bool
    {
        return $this->isAssigneeOrCreator($notifiable);
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
