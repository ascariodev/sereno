<?php

namespace App\Listeners;

use App\Enums\NotificationType;
use App\Events\MentionCreated;
use App\Events\MentionRemoved;
use App\Models\AppNotification;
use App\Models\Channel;
use App\Models\Message;
use App\Models\User;
use App\Notifications\ChatMentionNotification;
use Throwable;

/**
 * Synchronous: both events are dispatched after the commit that changed the mention rows, so the queued
 * notification only checks the row (shouldSend) and the delete finds any row already stored.
 */
class SyncChatMentionNotification
{
    public function handleCreated(MentionCreated $event): void
    {
        try {
            $this->notify($event);
        } catch (Throwable $e) {
            report($e);
        }
    }

    public function handleRemoved(MentionRemoved $event): void
    {
        AppNotification::query()
            ->withoutGlobalScopes()
            ->where('user_id', $event->userId)
            ->where('organization_id', $event->organizationId)
            ->where('type', NotificationType::ChatMention->value)
            ->where('subject_type', Message::class)
            ->where('subject_id', $event->messageId)
            ->delete();
    }

    private function notify(MentionCreated $event): void
    {
        $user = User::query()->find($event->userId);
        $channel = Channel::withoutGlobalScopes()
            ->where('organization_id', $event->organizationId)
            ->find($event->channelId, ['id', 'project_id', 'name']);

        $notification = $channel === null ? null : ChatMentionNotification::fromEvent($event, $channel);

        if ($user !== null && $notification !== null) {
            $user->notify($notification);
        }
    }
}
