<?php

namespace App\Events;

use App\Http\Resources\MessageResource;
use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Tells one mentioned user, in their private channel, that a message mentions them.
 * Holds the serialized message instead of the model (the queue worker has no active organization).
 */
class MentionCreated implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $channelId;

    public readonly ?int $parentId;

    /** @var array<string, mixed> */
    public readonly array $message;

    public function __construct(public readonly int $userId, Message $message)
    {
        $this->organizationId = $message->organization_id;
        $this->channelId = $message->channel_id;
        $this->parentId = $message->parent_id;
        $this->message = (new MessageResource($message->loadMissing(['user:id,name', 'mentionedUsers:id,name'])))->resolve();
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('users.'.$this->userId);
    }

    public function broadcastAs(): string
    {
        return 'mention.created';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return [
            'organization_id' => $this->organizationId,
            'channel_id' => $this->channelId,
            'parent_id' => $this->parentId,
            'message' => $this->message,
        ];
    }
}
