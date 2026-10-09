<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/** Plain values, not models: the queue worker has no active organization to restore them. `root` has the recalculated counters. */
class MessageDeleted implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $channelId;

    public readonly int $id;

    public readonly ?int $parentId;

    public readonly ?string $deletedAt;

    /** @var array{id: int, replies_count: int, last_reply_at: string|null, recent_participants: array<int, array{id: int, name: string}>} */
    public readonly array $root;

    public function __construct(Message $message, ?Message $root = null)
    {
        $root ??= $message;

        $this->organizationId = $message->organization_id;
        $this->channelId = $message->channel_id;
        $this->id = $message->id;
        $this->parentId = $message->parent_id;
        $this->deletedAt = $message->deleted_at?->toJSON();
        $this->root = [
            'id' => $root->id,
            'replies_count' => $root->replies_count,
            'last_reply_at' => $root->last_reply_at?->toJSON(),
            // Set by MessageController::loadParticipants; [] when the root has no live replies.
            'recent_participants' => $root->relationLoaded('recentParticipants')
                ? $root->recentParticipants->map(fn ($user) => ['id' => $user->id, 'name' => $user->name])->values()->all()
                : [],
        ];
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("organizations.{$this->organizationId}.channels.{$this->channelId}");
    }

    public function broadcastAs(): string
    {
        return 'message.deleted';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return [
            'id' => $this->id,
            'channel_id' => $this->channelId,
            'parent_id' => $this->parentId,
            'deleted_at' => $this->deletedAt,
            'root' => $this->root,
        ];
    }
}
