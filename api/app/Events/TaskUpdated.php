<?php

namespace App\Events;

use App\Http\Controllers\Api\TaskController;
use App\Http\Resources\TaskResource;
use App\Models\Task;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Holds the serialized task instead of the model: the queue worker has no active organization. Loads what
 * TaskController::index loads (L-37); the caller sets `project` on the task so key() needs no query.
 */
class TaskUpdated implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $projectId;

    /** @var array<string, mixed> */
    public readonly array $task;

    public function __construct(Task $task)
    {
        $this->organizationId = $task->organization_id;
        $this->projectId = $task->project_id;
        $this->task = (new TaskResource($task->loadMissing(TaskController::RELATIONS)))->resolve();
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("organizations.{$this->organizationId}.projects.{$this->projectId}");
    }

    public function broadcastAs(): string
    {
        return 'task.updated';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return ['task' => $this->task];
    }
}
