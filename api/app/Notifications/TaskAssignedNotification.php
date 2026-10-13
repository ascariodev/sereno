<?php

namespace App\Notifications;

use App\Enums\NotificationType;
use App\Models\Task;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Notifications\Concerns\DelaysMail;
use App\Support\MailMarkdown;
use App\Support\ProjectAccess;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Str;

class TaskAssignedNotification extends Notification implements ShouldQueue
{
    use DelaysMail;
    use Queueable;

    private const TITLE_LIMIT = 120;

    public function __construct(
        public readonly int $organizationId,
        public readonly int $projectId,
        public readonly int $taskId,
        public readonly string $taskKey,
        public readonly string $taskTitle,
        public readonly int $actorId,
        public readonly string $actorName,
    ) {}

    public static function for(Task $task, User $actor): self
    {
        return new self(
            $task->organization_id,
            $task->project_id,
            $task->id,
            $task->key(),
            Str::limit($task->title, self::TITLE_LIMIT, '...'),
            $actor->id,
            $actor->name,
        );
    }

    public function shouldSend(object $notifiable, string $channel): bool
    {
        if ($this->readInInbox($notifiable, $channel)) {
            return false;
        }

        if ($channel === 'mail' && ! $notifiable->wantsEmail(NotificationType::TaskAssigned)) {
            return false;
        }

        $assigneeId = Task::query()->withoutGlobalScopes()->whereKey($this->taskId)->value('assignee_id');

        return $assigneeId === $notifiable->id
            && ProjectAccess::canViewId($notifiable, $this->organizationId, $this->projectId);
    }

    /** @return list<class-string|string> */
    public function via(object $notifiable): array
    {
        return $notifiable->wantsEmail(NotificationType::TaskAssigned) ? [AppChannel::class, 'mail'] : [AppChannel::class];
    }

    /** @return array<string, mixed> */
    public function toApp(User $notifiable): array
    {
        return [
            'type' => NotificationType::TaskAssigned->value,
            'organization_id' => $this->organizationId,
            'project_id' => $this->projectId,
            'subject' => (new Task)->forceFill(['id' => $this->taskId]),
            'data' => [
                'task_id' => $this->taskId,
                'task_key' => $this->taskKey,
                'task_title' => $this->taskTitle,
                'actor_id' => $this->actorId,
                'actor_name' => $this->actorName,
            ],
        ];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject(__(':actor assigned you :task', ['actor' => $this->actorName, 'task' => $this->taskKey]))
            ->line(__(':actor assigned you the task :task: :title', [
                'actor' => MailMarkdown::escape($this->actorName),
                'task' => $this->taskKey,
                'title' => MailMarkdown::escape($this->taskTitle),
            ]))
            ->action(__('View task'), rtrim(config('app.frontend_url'), '/')."/projects/{$this->projectId}/plan?task={$this->taskId}&organization={$this->organizationId}");
    }
}
