<?php

namespace App\Events;

use App\Http\Controllers\Api\MessageController;
use App\Http\Resources\MessageResource;
use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Holds the serialized message instead of the model: the queue worker has no active organization,
 * so OrganizationScope would fail to restore it.
 */
class MessageUpdated implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $channelId;

    /** @var array<string, mixed> */
    public readonly array $message;

    public function __construct(Message $message)
    {
        $this->organizationId = $message->organization_id;
        $this->channelId = $message->channel_id;
        $message->loadMissing(MessageController::RELATIONS);
        if (! $message->relationLoaded('recentParticipants')) {
            MessageController::loadParticipants([$message]);
        }
        $this->message = (new MessageResource($message))->resolve();
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("organizations.{$this->organizationId}.channels.{$this->channelId}");
    }

    public function broadcastAs(): string
    {
        return 'message.updated';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return ['message' => $this->message];
    }
}
