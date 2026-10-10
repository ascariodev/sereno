<?php

namespace App\Events;

use App\Models\Task;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/** Plain ids: the row no longer exists when the worker runs. */
class TaskDeleted implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $projectId;

    public readonly int $id;

    public function __construct(Task $task)
    {
        $this->organizationId = $task->organization_id;
        $this->projectId = $task->project_id;
        $this->id = $task->id;
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("organizations.{$this->organizationId}.projects.{$this->projectId}");
    }

    public function broadcastAs(): string
    {
        return 'task.deleted';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return ['id' => $this->id, 'project_id' => $this->projectId];
    }
}
