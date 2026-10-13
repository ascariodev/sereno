<?php

use App\Enums\NotificationType;
use App\Models\AppNotification;
use App\Support\NotificationUrl;

function notificationRow(NotificationType $type, ?int $projectId, array $data): AppNotification
{
    return (new AppNotification)->forceFill([
        'type' => $type->value,
        'organization_id' => 7,
        'project_id' => $projectId,
        'data' => $data,
    ]);
}

beforeEach(fn () => config(['app.frontend_url' => 'https://app.test/']));

it('builds the task url for the three task types', function (NotificationType $type) {
    $row = notificationRow($type, 3, ['task_id' => 9]);

    expect(NotificationUrl::for($row))->toBe('https://app.test/projects/3/plan?task=9&organization=7');
})->with([NotificationType::TaskAssigned, NotificationType::TaskCommentMention, NotificationType::TaskCommented]);

it('builds the chat url for a loose message', function () {
    $row = notificationRow(NotificationType::ChatMention, null, ['channel_id' => 4, 'message_id' => 11, 'parent_id' => null]);

    expect(NotificationUrl::for($row))->toBe('https://app.test/channels/4?message=11&organization=7');
});

it('builds the chat url for a message inside a thread', function () {
    $row = notificationRow(NotificationType::ChatMention, 3, ['channel_id' => 4, 'message_id' => 11, 'parent_id' => 10]);

    expect(NotificationUrl::for($row))->toBe('https://app.test/channels/4?thread=10&organization=7');
});

it('tolerates a chat row without parent_id', function () {
    $row = notificationRow(NotificationType::ChatMention, null, ['channel_id' => 4, 'message_id' => 11]);

    expect(NotificationUrl::for($row))->toBe('https://app.test/channels/4?message=11&organization=7');
});
