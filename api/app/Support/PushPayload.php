<?php

namespace App\Support;

use App\Enums\NotificationType;
use App\Models\AppNotification;
use App\Models\User;
use ErrorException;
use Illuminate\Support\Str;
use TypeError;
use UnexpectedValueException;
use ValueError;

class PushPayload
{
    public const MAX_BYTES = 3000;

    private const TITLE_LIMIT = 200;

    private const ELLIPSIS = '…';

    /**
     * JSON for the Web Push body, or null when the row has an unknown type or incomplete data (the caller skips it).
     * The encrypted payload may carry about 4 KB: the JSON stays under MAX_BYTES UTF-8 bytes, trimming the body.
     */
    public static function for(AppNotification $notification, User $user): ?string
    {
        $previous = app()->getLocale();
        app()->setLocale($user->preferredLocale() ?? config('app.locale'));

        try {
            return self::build($notification);
        } catch (ValueError|TypeError|ErrorException|UnexpectedValueException) {
            return null;
        } finally {
            app()->setLocale($previous);
        }
    }

    private static function build(AppNotification $notification): string
    {
        $data = $notification->data;
        $type = NotificationType::from($notification->type);
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

        return self::encode([
            'uuid' => $notification->uuid,
            'type' => $type->value,
            'title' => Str::limit($title, self::TITLE_LIMIT, self::ELLIPSIS, preserveWords: false),
            'body' => $body,
            'url' => NotificationUrl::for($notification),
            'tag' => $tag,
        ]);
    }

    /** @param  array<string, mixed>  $payload */
    private static function encode(array $payload): string
    {
        $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;
        $json = json_encode($payload, $flags);

        if (strlen($json) <= self::MAX_BYTES) {
            return $json;
        }

        $body = $payload['body'];
        $fits = fn (int $chars): string => json_encode([...$payload, 'body' => rtrim(mb_substr($body, 0, $chars)).self::ELLIPSIS], $flags);
        $low = 0;
        $high = mb_strlen($body);

        while ($low < $high) {
            $middle = intdiv($low + $high + 1, 2);

            if (strlen($fits($middle)) <= self::MAX_BYTES) {
                $low = $middle;
            } else {
                $high = $middle - 1;
            }
        }

        return $fits($low);
    }

    /** @param  array<string, mixed>  $data */
    private static function text(array $data, string $key): string
    {
        $value = $data[$key] ?? null;

        if (! is_string($value)) {
            throw new UnexpectedValueException("Missing {$key}");
        }

        return $value;
    }
}
