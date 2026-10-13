<?php

namespace App\Events;

use App\Http\Resources\NotificationResource;
use App\Models\AppNotification;
use App\Models\User;
use App\Support\ProjectAccess;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Tells a user, in their private channel, that a notification reached their inbox.
 * Holds the serialized resource instead of the model (the queue worker has no active organization).
 */
class NotificationCreated implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public readonly int $userId;

    public readonly int $organizationId;

    public readonly ?int $projectId;

    /** @var array<string, mixed> */
    public readonly array $notification;

    public function __construct(AppNotification $notification)
    {
        $this->userId = $notification->user_id;
        $this->organizationId = $notification->organization_id;
        $this->projectId = $notification->project_id;
        $this->notification = (new NotificationResource($notification))->resolve();
    }

    /**
     * Checked here and not in `broadcastWhen`, which runs at dispatch: the queued job calls this in the worker,
     * and no channels means nothing is sent if the membership or the project access was revoked meanwhile.
     *
     * @return PrivateChannel|array{}
     */
    public function broadcastOn(): PrivateChannel|array
    {
        $user = User::query()
            ->whereKey($this->userId)
            ->whereHas('organizations', fn ($query) => $query->whereKey($this->organizationId))
            ->first();

        if ($user === null) {
            return [];
        }

        $canSee = $this->projectId === null
            || ProjectAccess::canViewId($user, $this->organizationId, $this->projectId);

        return $canSee ? new PrivateChannel('users.'.$this->userId) : [];
    }

    public function broadcastAs(): string
    {
        return 'notification.created';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return [
            'organization_id' => $this->organizationId,
            'notification' => $this->notification,
        ];
    }
}
