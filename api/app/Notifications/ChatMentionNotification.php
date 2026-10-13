<?php

namespace App\Notifications;

use App\Enums\NotificationType;
use App\Events\MentionCreated;
use App\Models\AppNotification;
use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageMention;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Support\MailMarkdown;
use App\Support\ProjectAccess;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Str;

class ChatMentionNotification extends Notification implements ShouldQueue
{
    use Queueable;

    private const EXCERPT_LIMIT = 140;

    public function __construct(
        public readonly int $organizationId,
        public readonly ?int $projectId,
        public readonly int $channelId,
        public readonly string $channelName,
        public readonly int $messageId,
        public readonly ?int $parentId,
        public readonly string $excerpt,
        public readonly int $actorId,
        public readonly string $actorName,
    ) {}

    public static function fromEvent(MentionCreated $event, Channel $channel): ?self
    {
        $author = $event->message['user'] ?? null;

        if ($author === null) {
            return null;
        }

        return new self(
            $event->organizationId,
            $channel->project_id,
            $channel->id,
            $channel->name,
            $event->message['id'],
            $event->parentId,
            self::excerpt($event->message['body'] ?? '', collect($event->message['mentions'] ?? [])->pluck('name', 'id')->all()),
            $author['id'],
            $author['name'],
        );
    }

    /**
     * Runs in the worker for each channel: the mention may have been removed (edit, delete) or the access lost
     * while the job waited. MentionRemoved deletes the row if the mention goes after it was stored. A mention
     * removed and added back before the first job ran queues a second one: the row of another job wins.
     */
    public function shouldSend(object $notifiable, string $channel): bool
    {
        if ($channel === 'mail' && ! $notifiable->wantsEmail(NotificationType::ChatMention)) {
            return false;
        }

        $alreadyNotified = AppNotification::query()
            ->withoutGlobalScopes()
            ->where('user_id', $notifiable->id)
            ->where('type', NotificationType::ChatMention->value)
            ->where('subject_type', Message::class)
            ->where('subject_id', $this->messageId)
            ->where('uuid', '!=', $this->id)
            ->exists();

        if ($alreadyNotified) {
            return false;
        }

        $stillMentioned = MessageMention::query()
            ->withoutGlobalScopes()
            ->where('message_id', $this->messageId)
            ->where('user_id', $notifiable->id)
            ->exists();

        if (! $stillMentioned) {
            return false;
        }

        return $this->projectId === null
            ? $notifiable->organizations()->whereKey($this->organizationId)->exists()
            : ProjectAccess::canViewId($notifiable, $this->organizationId, $this->projectId);
    }

    /** @return list<class-string|string> */
    public function via(object $notifiable): array
    {
        return $notifiable->wantsEmail(NotificationType::ChatMention) ? [AppChannel::class, 'mail'] : [AppChannel::class];
    }

    /** @return array<string, mixed> */
    public function toApp(User $notifiable): array
    {
        return [
            'type' => NotificationType::ChatMention->value,
            'organization_id' => $this->organizationId,
            'project_id' => $this->projectId,
            'subject' => (new Message)->forceFill(['id' => $this->messageId]),
            'data' => [
                'channel_id' => $this->channelId,
                'channel_name' => $this->channelName,
                'message_id' => $this->messageId,
                'parent_id' => $this->parentId,
                'message_excerpt' => $this->excerpt,
                'actor_id' => $this->actorId,
                'actor_name' => $this->actorName,
            ],
        ];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $query = $this->parentId === null ? "message={$this->messageId}" : "thread={$this->parentId}";

        return (new MailMessage)
            ->subject(__(':actor mentioned you in #:channel', ['actor' => $this->actorName, 'channel' => $this->channelName]))
            ->line(__(':actor mentioned you in #:channel: :excerpt', [
                'actor' => $this->actorName,
                'channel' => $this->channelName,
                'excerpt' => MailMarkdown::escape($this->excerpt),
            ]))
            ->action(__('View message'), rtrim(config('app.frontend_url'), '/')."/channels/{$this->channelId}?{$query}");
    }

    /** @param  array<int, string>  $names */
    private static function excerpt(string $body, array $names): string
    {
        $text = preg_replace_callback('/<@([1-9][0-9]{0,17})>/', fn (array $m) => '@'.($names[(int) $m[1]] ?? ''), $body);

        return Str::limit(trim(preg_replace('/\s+/u', ' ', $text)), self::EXCERPT_LIMIT, '...');
    }
}
