<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Tells one user, in their private channel, that a message no longer mentions them (edited or deleted).
 * Carries only ids: the user may no longer be able to read the message (e.g. left the organization).
 */
class MentionRemoved implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $channelId;

    public readonly ?int $parentId;

    public readonly int $messageId;

    public function __construct(public readonly int $userId, Message $message)
    {
        $this->organizationId = $message->organization_id;
        $this->channelId = $message->channel_id;
        $this->parentId = $message->parent_id;
        $this->messageId = $message->id;
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('users.'.$this->userId);
    }

    public function broadcastAs(): string
    {
        return 'mention.removed';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return [
            'organization_id' => $this->organizationId,
            'channel_id' => $this->channelId,
            'parent_id' => $this->parentId,
            'message_id' => $this->messageId,
        ];
    }
}
