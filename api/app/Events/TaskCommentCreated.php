<?php

namespace App\Events;

use App\Http\Controllers\Api\TaskCommentController;
use App\Http\Resources\TaskCommentResource;
use App\Models\TaskComment;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Holds the serialized comment instead of the model: the queue worker has no active organization. Loads what
 * TaskCommentController::index loads (L-37).
 */
class TaskCommentCreated implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $projectId;

    /** @var array<string, mixed> */
    public readonly array $comment;

    public function __construct(TaskComment $comment, int $projectId)
    {
        $this->organizationId = $comment->organization_id;
        $this->projectId = $projectId;
        $this->comment = (new TaskCommentResource($comment->loadMissing(TaskCommentController::RELATIONS)))->resolve();
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("organizations.{$this->organizationId}.projects.{$this->projectId}");
    }

    public function broadcastAs(): string
    {
        return 'task.comment.created';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return ['comment' => $this->comment];
    }
}
