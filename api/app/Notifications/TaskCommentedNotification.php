<?php

namespace App\Notifications;

use App\Enums\NotificationType;
use App\Models\User;

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
            'actor' => $this->actorName,
            'task' => $this->taskKey,
            'excerpt' => $this->excerpt,
        ]);
    }
}
