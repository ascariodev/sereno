<?php

namespace App\Events;

use App\Models\LogSource;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * First use of a log source key. Holds scalars instead of the model, and never the key or its prefix:
 * everyone who can view the project receives it.
 */
class LogSourceConnected implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $projectId;

    public readonly int $sourceId;

    public readonly string $lastUsedAt;

    public function __construct(LogSource $source)
    {
        $this->organizationId = $source->organization_id;
        $this->projectId = $source->project_id;
        $this->sourceId = $source->id;
        $this->lastUsedAt = $source->last_used_at->toJSON();
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("organizations.{$this->organizationId}.projects.{$this->projectId}");
    }

    public function broadcastAs(): string
    {
        return 'log_source.connected';
    }

    /** @return array{id: int, project_id: int, last_used_at: string} */
    public function broadcastWith(): array
    {
        return [
            'id' => $this->sourceId,
            'project_id' => $this->projectId,
            'last_used_at' => $this->lastUsedAt,
        ];
    }
}
