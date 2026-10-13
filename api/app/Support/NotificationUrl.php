<?php

namespace App\Support;

use App\Enums\NotificationType;
use App\Models\AppNotification;

class NotificationUrl
{
    public static function for(AppNotification $notification): string
    {
        $data = $notification->data;

        return match (NotificationType::from($notification->type)) {
            NotificationType::TaskAssigned,
            NotificationType::TaskCommentMention,
            NotificationType::TaskCommented => self::task($notification->organization_id, $notification->project_id, $data['task_id']),
            NotificationType::ChatMention => self::chatMessage($notification->organization_id, $data['channel_id'], $data['message_id'], $data['parent_id'] ?? null),
        };
    }

    public static function task(int $organizationId, int $projectId, int $taskId): string
    {
        return self::base()."/projects/{$projectId}/plan?task={$taskId}&organization={$organizationId}";
    }

    public static function chatMessage(int $organizationId, int $channelId, int $messageId, ?int $parentId): string
    {
        $query = $parentId === null ? "message={$messageId}" : "thread={$parentId}";

        return self::base()."/channels/{$channelId}?{$query}&organization={$organizationId}";
    }

    private static function base(): string
    {
        return rtrim(config('app.frontend_url'), '/');
    }
}
