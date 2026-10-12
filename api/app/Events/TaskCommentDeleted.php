<?php

namespace App\Events;

use App\Http\Controllers\Api\TaskController;
use App\Models\Task;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

class TaskCommentDeleted implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $commentsCount;

    public function __construct(
        public readonly int $organizationId,
        public readonly int $projectId,
        public readonly int $taskId,
        public readonly int $commentId,
    ) {
        $this->commentsCount = (int) Task::query()->withoutGlobalScopes()->whereKey($taskId)
            ->withCount(TaskController::counts())->value('comments_count');
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("organizations.{$this->organizationId}.projects.{$this->projectId}");
    }

    public function broadcastAs(): string
    {
        return 'task.comment.deleted';
    }

    /** @return array<string, int> */
    public function broadcastWith(): array
    {
        return ['id' => $this->commentId, 'task_id' => $this->taskId, 'comments_count' => $this->commentsCount];
    }
}
