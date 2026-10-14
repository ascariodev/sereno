<?php

namespace App\Support;

use App\Enums\NotificationType;
use App\Models\AppNotification;
use App\Models\User;
use Illuminate\Support\Str;
use Illuminate\Support\Traits\Localizable;

class PushPayload
{
    public const MAX_BYTES = 3000;

    /**
     * Expo caps each message at 4096 bytes, `to` included (the token is up to 255 characters), so the rest keeps a
     * margin. Measured with the JSON flags the HTTP client sends (unicode escaped): an accent takes 6 bytes there.
     */
    public const MOBILE_MAX_BYTES = 4096 - 300;

    private const WEB_JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;

    private const MOBILE_JSON_FLAGS = JSON_THROW_ON_ERROR;

    private const TITLE_WIDTH_LIMIT = 200;

    private const ELLIPSIS = '…';

    /**
     * JSON for the Web Push body, or null when the row has an unknown type or incomplete data (the caller skips it).
     * The encrypted payload may carry about 4 KB: the JSON stays under MAX_BYTES UTF-8 bytes, trimming the body.
     */
    public static function for(AppNotification $notification, User $user): ?string
    {
        $content = self::content($notification, $user);

        return $content === null ? null : json_encode(self::fit($content, self::MAX_BYTES, self::WEB_JSON_FLAGS), self::WEB_JSON_FLAGS);
    }

    /**
     * Message for the Expo push service (without `to`), or null like `for`. Stays under MOBILE_MAX_BYTES, trimming the body.
     *
     * @return array{title: string, body: string, data: array{url: string, organizationId: int}}|null
     */
    public static function mobile(AppNotification $notification, User $user): ?array
    {
        $content = self::content($notification, $user);

        if ($content === null) {
            return null;
        }

        return self::fit([
            'title' => $content['title'],
            'body' => $content['body'],
            'data' => ['url' => $content['url'], 'organizationId' => (int) $notification->organization_id],
        ], self::MOBILE_MAX_BYTES, self::MOBILE_JSON_FLAGS);
    }

    /** @return array{uuid: string, type: string, title: string, body: string, url: string, tag: string}|null */
    private static function content(AppNotification $notification, User $user): ?array
    {
        $type = NotificationType::tryFrom($notification->type);

        if ($type === null || ! self::hasRequiredData($notification, $type)) {
            return null;
        }

        $locale = $user->preferredLocale() ?? config('app.locale');

        return (new class
        {
            use Localizable;
        })->withLocale($locale, fn () => self::build($notification, $type));
    }

    private static function hasRequiredData(AppNotification $notification, NotificationType $type): bool
    {
        $required = match ($type) {
            NotificationType::TaskAssigned => ['actor_name', 'task_key', 'task_title', 'task_id'],
            NotificationType::TaskCommentMention,
            NotificationType::TaskCommented => ['actor_name', 'task_key', 'comment_excerpt', 'task_id'],
            NotificationType::ChatMention => ['actor_name', 'channel_name', 'message_excerpt', 'channel_id', 'message_id'],
        };

        foreach ($required as $key) {
            $value = $notification->data[$key] ?? null;
            $valid = str_ends_with($key, '_id') ? is_numeric($value) : is_string($value);

            if (! $valid) {
                return false;
            }
        }

        return $type === NotificationType::ChatMention || is_numeric($notification->project_id);
    }

    /** @return array{uuid: string, type: string, title: string, body: string, url: string, tag: string} */
    private static function build(AppNotification $notification, NotificationType $type): array
    {
        $data = $notification->data;
        $actor = self::text($data, 'actor_name');

        [$title, $body, $tag] = match ($type) {
            NotificationType::TaskAssigned => [
                __(':actor assigned you :task', ['actor' => $actor, 'task' => self::text($data, 'task_key')]),
                self::text($data, 'task_title'),
                'task-'.(int) $data['task_id'],
            ],
            NotificationType::TaskCommentMention => [
                __(':actor mentioned you in :task', ['actor' => $actor, 'task' => self::text($data, 'task_key')]),
                self::text($data, 'comment_excerpt'),
                'task-'.(int) $data['task_id'],
            ],
            NotificationType::TaskCommented => [
                __(':actor commented on :task', ['actor' => $actor, 'task' => self::text($data, 'task_key')]),
                self::text($data, 'comment_excerpt'),
                'task-'.(int) $data['task_id'],
            ],
            NotificationType::ChatMention => [
                __(':actor mentioned you in #:channel', ['actor' => $actor, 'channel' => self::text($data, 'channel_name')]),
                self::text($data, 'message_excerpt'),
                'channel-'.(int) $data['channel_id'],
            ],
        };

        return [
            'uuid' => $notification->uuid,
            'type' => $type->value,
            'title' => Str::limit($title, self::TITLE_WIDTH_LIMIT, self::ELLIPSIS, preserveWords: false),
            'body' => $body,
            'url' => NotificationUrl::for($notification),
            'tag' => $tag,
        ];
    }

    /**
     * @template T of array{body: string}
     *
     * @param  T  $payload
     * @return T the payload with the body trimmed until its JSON fits in $maxBytes
     */
    private static function fit(array $payload, int $maxBytes, int $flags): array
    {
        if (strlen(json_encode($payload, $flags)) <= $maxBytes) {
            return $payload;
        }

        $body = $payload['body'];
        $trimmed = fn (int $chars): array => [...$payload, 'body' => rtrim(mb_substr($body, 0, $chars)).self::ELLIPSIS];
        $low = 0;
        $high = mb_strlen($body);

        while ($low < $high) {
            $middle = intdiv($low + $high + 1, 2);

            if (strlen(json_encode($trimmed($middle), $flags)) <= $maxBytes) {
                $low = $middle;
            } else {
                $high = $middle - 1;
            }
        }

        return $trimmed($low);
    }

    /** @param  array<string, mixed>  $data */
    private static function text(array $data, string $key): string
    {
        return $data[$key];
    }
}
