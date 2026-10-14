<?php

use App\Enums\Locale;
use App\Enums\NotificationType;
use App\Models\AppNotification;
use App\Models\User;
use App\Support\PushPayload;

function pushRow(NotificationType $type, array $data, ?int $projectId = 3): AppNotification
{
    return (new AppNotification)->forceFill([
        'uuid' => '0b9c3f2e-1111-4222-8333-444455556666',
        'type' => $type->value,
        'organization_id' => 7,
        'project_id' => $projectId,
        'data' => $data,
    ]);
}

function pushUser(string $locale): User
{
    return (new User)->forceFill(['locale' => Locale::from($locale)]);
}

function decodePush(?string $json): array
{
    expect($json)->not->toBeNull();

    return json_decode($json, true, flags: JSON_THROW_ON_ERROR);
}

beforeEach(fn () => config(['app.frontend_url' => 'https://app.test']));

it('builds the payload of each type in english', function (NotificationType $type, array $data, string $title, string $body, string $url, string $tag) {
    $payload = decodePush(PushPayload::for(pushRow($type, $data + ['actor_name' => 'Ana'], 3), pushUser('en')));

    expect($payload)->toBe([
        'uuid' => '0b9c3f2e-1111-4222-8333-444455556666',
        'type' => $type->value,
        'title' => $title,
        'body' => $body,
        'url' => $url,
        'tag' => $tag,
    ]);
})->with([
    'assigned' => [NotificationType::TaskAssigned, ['task_id' => 9, 'task_key' => 'WEB-9', 'task_title' => 'Fix it'], 'Ana assigned you WEB-9', 'Fix it', 'https://app.test/projects/3/plan?task=9&organization=7', 'task-9'],
    'commented' => [NotificationType::TaskCommented, ['task_id' => 9, 'task_key' => 'WEB-9', 'comment_excerpt' => 'Looks good'], 'Ana commented on WEB-9', 'Looks good', 'https://app.test/projects/3/plan?task=9&organization=7', 'task-9'],
    'comment mention' => [NotificationType::TaskCommentMention, ['task_id' => 9, 'task_key' => 'WEB-9', 'comment_excerpt' => 'ping'], 'Ana mentioned you in WEB-9', 'ping', 'https://app.test/projects/3/plan?task=9&organization=7', 'task-9'],
    'chat' => [NotificationType::ChatMention, ['channel_id' => 4, 'channel_name' => 'general', 'message_id' => 11, 'parent_id' => 10, 'message_excerpt' => 'hey'], 'Ana mentioned you in #general', 'hey', 'https://app.test/channels/4?thread=10&organization=7', 'channel-4'],
]);

it('translates the title to the locale of the user and keeps human content as is', function () {
    $row = pushRow(NotificationType::TaskCommented, ['task_id' => 9, 'task_key' => 'WEB-9', 'comment_excerpt' => 'Revisión lista 🎉 :actor', 'actor_name' => 'Zoë']);

    $payload = decodePush(PushPayload::for($row, pushUser('es')));

    expect($payload['title'])->toBe('Zoë comentó en WEB-9')
        ->and($payload['body'])->toBe('Revisión lista 🎉 :actor');
});

it('restores the app locale after building', function () {
    app()->setLocale('en');

    PushPayload::for(pushRow(NotificationType::TaskAssigned, ['task_id' => 1, 'task_key' => 'A-1', 'task_title' => 't', 'actor_name' => 'Ana']), pushUser('es'));

    expect(app()->getLocale())->toBe('en');
});

it('falls back to the app locale for a user without locale', function () {
    $payload = decodePush(PushPayload::for(
        pushRow(NotificationType::TaskAssigned, ['task_id' => 1, 'task_key' => 'A-1', 'task_title' => 't', 'actor_name' => 'Ana']),
        new User,
    ));

    expect($payload['title'])->toBe('Ana assigned you A-1');
});

it('trims a long multibyte body to the byte cap without breaking characters', function (string $unit) {
    $row = pushRow(NotificationType::TaskCommented, ['task_id' => 9, 'task_key' => 'WEB-9', 'comment_excerpt' => str_repeat($unit, 4000), 'actor_name' => 'Ana']);

    $json = PushPayload::for($row, pushUser('en'));
    $payload = decodePush($json);

    expect(strlen($json))->toBeLessThanOrEqual(PushPayload::MAX_BYTES)
        ->and(strlen($json))->toBeGreaterThan(PushPayload::MAX_BYTES - 8)
        ->and(mb_check_encoding($payload['body'], 'UTF-8'))->toBeTrue()
        ->and($payload['body'])->toEndWith('…')
        ->and(mb_substr($payload['body'], 0, -1))->toMatch('/^('.preg_quote($unit, '/').')+$/u');
})->with(['ascii' => 'a', 'accents' => 'é', 'emoji' => '🎉', 'cjk' => '漢', 'quotes' => '"']);

it('fits a long title and a long body together', function () {
    $row = pushRow(NotificationType::ChatMention, ['channel_id' => 4, 'channel_name' => str_repeat('🎉', 500), 'message_id' => 1, 'message_excerpt' => str_repeat('ñ', 3000), 'actor_name' => str_repeat('é', 500)]);

    $json = PushPayload::for($row, pushUser('en'));

    expect(strlen($json))->toBeLessThanOrEqual(PushPayload::MAX_BYTES)
        ->and(decodePush($json)['title'])->toEndWith('…');
});

it('leaves a short body untouched', function () {
    $row = pushRow(NotificationType::TaskCommented, ['task_id' => 9, 'task_key' => 'WEB-9', 'comment_excerpt' => 'Gracias 🙏', 'actor_name' => 'Ana']);

    expect(decodePush(PushPayload::for($row, pushUser('en')))['body'])->toBe('Gracias 🙏');
});

it('returns null for an unknown type or incomplete data', function (string $type, array $data) {
    $row = (new AppNotification)->forceFill(['uuid' => 'x', 'type' => $type, 'organization_id' => 7, 'project_id' => 3, 'data' => $data]);

    expect(PushPayload::for($row, pushUser('en')))->toBeNull();
})->with([
    'unknown type' => ['mystery', ['task_id' => 1]],
    'no actor' => ['task_assigned', ['task_id' => 1, 'task_key' => 'A-1', 'task_title' => 't']],
    'no task id' => ['task_assigned', ['task_key' => 'A-1', 'task_title' => 't', 'actor_name' => 'Ana']],
    'no excerpt' => ['task_commented', ['task_id' => 1, 'task_key' => 'A-1', 'actor_name' => 'Ana']],
    'no channel' => ['chat_mention', ['message_id' => 1, 'message_excerpt' => 'x', 'actor_name' => 'Ana']],
]);

it('builds the mobile message with the url and the organization in its data', function () {
    $row = pushRow(NotificationType::TaskAssigned, ['task_id' => 9, 'task_key' => 'WEB-9', 'task_title' => 'Arreglar', 'actor_name' => 'Ana']);

    expect(PushPayload::mobile($row, pushUser('es')))->toBe([
        'title' => 'Ana te asignó WEB-9',
        'body' => 'Arreglar',
        'data' => ['url' => 'https://app.test/projects/3/plan?task=9&organization=7', 'organizationId' => 7],
    ]);
});

it('trims the mobile message to its byte cap as the HTTP client encodes it', function (string $unit) {
    $row = pushRow(NotificationType::TaskCommented, ['task_id' => 9, 'task_key' => 'WEB-9', 'comment_excerpt' => str_repeat($unit, 4000), 'actor_name' => 'Ana']);

    $message = PushPayload::mobile($row, pushUser('en'));
    $wireBytes = strlen(json_encode(['to' => 'ExponentPushToken['.str_repeat('x', 236).']', ...$message], JSON_THROW_ON_ERROR));

    expect(strlen(json_encode($message, JSON_THROW_ON_ERROR)))->toBeLessThanOrEqual(PushPayload::MOBILE_MAX_BYTES)
        ->and($wireBytes)->toBeLessThanOrEqual(4096)
        ->and($message['body'])->toEndWith('…')
        ->and(mb_check_encoding($message['body'], 'UTF-8'))->toBeTrue();
})->with(['ascii' => 'a', 'accents' => 'é', 'emoji' => '🎉']);

it('returns no mobile message for incomplete data', function () {
    $row = pushRow(NotificationType::TaskAssigned, ['task_key' => 'A-1', 'task_title' => 't', 'actor_name' => 'Ana']);

    expect(PushPayload::mobile($row, pushUser('en')))->toBeNull();
});
