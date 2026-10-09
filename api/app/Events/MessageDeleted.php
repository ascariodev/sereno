<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Holds plain values instead of models: the queue worker has no active organization, so OrganizationScope
 * would fail to restore them. `root` carries the counters already recalculated (the deleted message itself
 * when it is a root).
 */
class MessageDeleted implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $organizationId;

    public readonly int $channelId;

    public readonly int $id;

    public readonly ?int $parentId;

    public readonly ?string $deletedAt;

    /** @var array{id: int, replies_count: int, last_reply_at: string|null} */
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
