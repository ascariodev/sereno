<?php

namespace App\Notifications\Channels;

use App\Events\NotificationCreated;
use App\Models\AppNotification;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Notifications\Notification;
use InvalidArgumentException;

/**
 * `toApp(User $notifiable): array` returns `type`, `organization_id` (explicit: queued notifications have no
 * active one), `subject` (model) and optionally `project_id` and `data`. Idempotent per notification id:
 * `NotificationCreated` goes out only when the row was inserted.
 * Nothing is stored for a user who is not a member of `organization_id`.
 */
class AppChannel
{
    public function send(object $notifiable, Notification $notification): void
    {
        if (! $notifiable instanceof User) {
            throw new InvalidArgumentException('App notifications can only be sent to users.');
        }

        $payload = $notification->toApp($notifiable);
        $subject = $payload['subject'] ?? null;

        if (! $subject instanceof Model || empty($payload['type']) || empty($payload['organization_id'])) {
            throw new InvalidArgumentException('toApp() must return a type, an organization_id and a subject model.');
        }

        if (! $notifiable->organizations()->whereKey($payload['organization_id'])->exists()) {
            return;
        }

        $inserted = AppNotification::query()->withoutGlobalScopes()->insertOrIgnore([
            'uuid' => $notification->id,
            'organization_id' => $payload['organization_id'],
            'user_id' => $notifiable->getKey(),
            'project_id' => $payload['project_id'] ?? null,
            'type' => $payload['type'],
            'subject_type' => $subject->getMorphClass(),
            'subject_id' => $subject->getKey(),
            'data' => json_encode((object) ($payload['data'] ?? []), JSON_THROW_ON_ERROR),
        ]);

        if ($inserted === 1) {
            NotificationCreated::dispatch(
                AppNotification::query()->withoutGlobalScopes()->where('uuid', $notification->id)->firstOrFail(),
            );
        }
    }
}
