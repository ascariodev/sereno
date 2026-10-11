<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/** Only ids: tells open member lists of owners and admins to reload. */
class OrganizationMembersChanged implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public readonly int $organizationId,
        public readonly int $userId,
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("organizations.{$this->organizationId}.members");
    }

    public function broadcastAs(): string
    {
        return 'organization.members_changed';
    }

    /** @return array<string, int> */
    public function broadcastWith(): array
    {
        return ['organization_id' => $this->organizationId, 'user_id' => $this->userId];
    }
}
