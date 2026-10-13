<?php

namespace App\Notifications;

use App\Enums\NotificationType;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Support\ProjectAccess;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

abstract class TaskCommentNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly int $organizationId,
        public readonly int $projectId,
        public readonly int $taskId,
        public readonly string $taskKey,
        public readonly string $taskTitle,
        public readonly int $commentId,
        public readonly string $excerpt,
        public readonly int $actorId,
        public readonly string $actorName,
    ) {}

    abstract protected function type(): NotificationType;

    abstract protected function stillRelevant(User $notifiable): bool;

    abstract protected function mailSubject(): string;

    abstract protected function mailLine(): string;

    public function shouldSend(object $notifiable, string $channel): bool
    {
        if ($channel === 'mail' && ! $notifiable->wantsEmail($this->type())) {
            return false;
        }

        return TaskComment::query()->withoutGlobalScopes()->whereKey($this->commentId)->exists()
            && $this->stillRelevant($notifiable)
            && ProjectAccess::canViewId($notifiable, $this->organizationId, $this->projectId);
    }

    /** @return list<class-string|string> */
    public function via(object $notifiable): array
    {
        return $notifiable->wantsEmail($this->type()) ? [AppChannel::class, 'mail'] : [AppChannel::class];
    }

    /** @return array<string, mixed> */
    public function toApp(User $notifiable): array
    {
        return [
            'type' => $this->type()->value,
            'organization_id' => $this->organizationId,
            'project_id' => $this->projectId,
            'subject' => (new TaskComment)->forceFill(['id' => $this->commentId]),
            'data' => [
                'task_id' => $this->taskId,
                'task_key' => $this->taskKey,
                'task_title' => $this->taskTitle,
                'comment_id' => $this->commentId,
                'comment_excerpt' => $this->excerpt,
                'actor_id' => $this->actorId,
                'actor_name' => $this->actorName,
            ],
        ];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject($this->mailSubject())
            ->line($this->mailLine())
            ->action(__('View task'), rtrim(config('app.frontend_url'), '/')."/projects/{$this->projectId}/plan?task={$this->taskId}&organization={$this->organizationId}");
    }

    protected function isAssigneeOrCreator(User $user): bool
    {
        $task = Task::query()->withoutGlobalScopes()->whereKey($this->taskId)->first(['assignee_id', 'created_by']);

        return $task !== null && ($task->assignee_id === $user->id || $task->created_by === $user->id);
    }
}
