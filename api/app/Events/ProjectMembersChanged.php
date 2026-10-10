<?php

namespace App\Events;

use App\Models\Channel;
use App\Models\Project;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/** Only ids: tells open project and channel views to reload the project member directory. */
class ProjectMembersChanged implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $projectId;

    public readonly ?int $channelId;

    public function __construct(Project $project)
    {
        $this->organizationId = $project->organization_id;
        $this->projectId = $project->id;
        $this->channelId = Channel::withoutGlobalScopes()->where('project_id', $project->id)->value('id');
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        $prefix = "organizations.{$this->organizationId}.";
        $channels = [new PrivateChannel("{$prefix}projects.{$this->projectId}")];

        if ($this->channelId !== null) {
            $channels[] = new PrivateChannel("{$prefix}channels.{$this->channelId}");
        }

        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'project.members_changed';
    }

    /** @return array<string, int> */
    public function broadcastWith(): array
    {
        return ['project_id' => $this->projectId];
    }
}
