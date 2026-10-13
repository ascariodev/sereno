<?php

namespace App\Jobs;

use App\Enums\NotificationType;
use App\Models\AppNotification;
use App\Models\PushSubscription;
use App\Models\User;
use App\Support\PushPayload;
use App\Support\PushSender;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Not retried by the queue: a retry would push again to the devices that already got it. Subscriptions that
 * failed on the network (or 429/5xx) go to a new job with only them, up to MAX_ATTEMPTS.
 * Everything is checked again in the worker: the row may have been read or deleted while the job waited.
 */
class SendPushNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const MAX_ATTEMPTS = 3;

    /** @var list<int> seconds before attempts 2 and 3 */
    public const RETRY_DELAYS = [30, 300];

    private const VAPID_SETTINGS = [
        'vapid_public_key' => 'VAPID_PUBLIC_KEY',
        'vapid_private_key' => 'VAPID_PRIVATE_KEY',
        'vapid_subject' => 'VAPID_SUBJECT',
    ];

    public int $tries = 1;

    /** @param  list<int>|null  $subscriptionIds  null = every subscription of the user */
    public function __construct(
        public readonly string $notificationUuid,
        public readonly ?array $subscriptionIds = null,
        public readonly int $attempt = 1,
    ) {}

    /** A queue failure is reported but must not undo the notification row or stop the other channels. */
    public static function dispatchAfterCommit(string $notificationUuid): void
    {
        DB::afterCommit(function () use ($notificationUuid) {
            try {
                static::dispatch($notificationUuid);
            } catch (Throwable $e) {
                report($e);
            }
        });
    }

    public function handle(PushSender $sender): void
    {
        $notification = AppNotification::query()->withoutGlobalScopes()->where('uuid', $this->notificationUuid)->first();
        $type = NotificationType::tryFrom((string) $notification?->type);
        $user = $notification ? User::query()->find($notification->user_id) : null;

        if (! $notification || $notification->read_at !== null || ! $user || ($type && ! $user->wantsPush($type))) {
            return;
        }

        $subscriptions = $user->pushSubscriptions()
            ->when($this->subscriptionIds !== null, fn ($query) => $query->whereKey($this->subscriptionIds))
            ->orderBy('id')
            ->get();

        if ($subscriptions->isEmpty()) {
            return;
        }

        $missing = array_values(array_filter(
            self::VAPID_SETTINGS,
            fn (string $env, string $key) => blank(config("workspace.push.{$key}")),
            ARRAY_FILTER_USE_BOTH,
        ));

        if ($missing !== []) {
            Log::warning('Web Push is not configured, push skipped: missing '.implode(', ', $missing).'.', [
                'notification' => $this->notificationUuid,
            ]);

            return;
        }

        $payload = PushPayload::for($notification, $user);

        if ($payload === null) {
            Log::warning('Push skipped: notification with unknown type or incomplete data.', [
                'notification' => $this->notificationUuid,
            ]);

            return;
        }

        $this->settle($sender->send($subscriptions, $payload));
    }

    /** @param  array<int, string>  $results */
    private function settle(array $results): void
    {
        $byOutcome = collect($results)->groupBy(fn (string $outcome) => $outcome, preserveKeys: true)
            ->map(fn ($group) => $group->keys()->all());

        if ($sent = $byOutcome->get(PushSender::SENT)) {
            PushSubscription::query()->whereKey($sent)->update(['last_used_at' => now()]);
        }

        if ($expired = $byOutcome->get(PushSender::EXPIRED)) {
            PushSubscription::query()->whereKey($expired)->delete();
        }

        if (($rejected = $byOutcome->get(PushSender::REJECTED))) {
            Log::warning('Push rejected by the push service.', [
                'notification' => $this->notificationUuid,
                'subscriptions' => $rejected,
            ]);
        }

        $failed = $byOutcome->get(PushSender::FAILED);

        if (! $failed) {
            return;
        }

        if ($this->attempt >= self::MAX_ATTEMPTS) {
            Log::warning('Push gave up after '.self::MAX_ATTEMPTS.' attempts.', [
                'notification' => $this->notificationUuid,
                'subscriptions' => $failed,
            ]);

            return;
        }

        static::dispatch($this->notificationUuid, $failed, $this->attempt + 1)
            ->delay(self::RETRY_DELAYS[$this->attempt - 1]);
    }
}
