<?php

namespace App\Notifications\Channels;

use App\Models\AppNotification;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Notifications\Notification;
use InvalidArgumentException;

/**
 * Stores in-app notifications with their tenant, unlike Laravel's `database` channel.
 *
 * The notification implements `toApp(User $notifiable): array` returning `type`, `organization_id`,
 * `subject` (the model it refers to), and optionally `project_id` and `data`. The organization is explicit
 * because queued notifications run without an active one. Retries are idempotent: the row is keyed by the
 * notification id, which Laravel fixes per notifiable before queuing.
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

        AppNotification::query()->withoutGlobalScopes()->insertOrIgnore([
            'uuid' => $notification->id,
            'organization_id' => $payload['organization_id'],
            'user_id' => $notifiable->getKey(),
            'project_id' => $payload['project_id'] ?? null,
            'type' => $payload['type'],
            'subject_type' => $subject->getMorphClass(),
            'subject_id' => $subject->getKey(),
            'data' => json_encode((object) ($payload['data'] ?? []), JSON_THROW_ON_ERROR),
        ]);
    }
}
