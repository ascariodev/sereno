<?php

namespace App\Jobs;

use App\Enums\NotificationType;
use App\Models\AppNotification;
use App\Models\ExpoPushToken;
use App\Models\PushSubscription;
use App\Models\User;
use App\Support\MobilePushSender;
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
 * Not retried by the queue: a retry would push again to the devices that already got it. Web subscriptions and Expo
 * tokens that failed on the network (or 429/5xx) go to a single new job with only them, up to MAX_ATTEMPTS; in that
 * job an empty list means the channel is done.
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

    /**
     * @param  list<int>|null  $subscriptionIds  null = every web subscription of the user
     * @param  list<int>|null  $expoTokenIds  null = every Expo token of the user
     */
    public function __construct(
        public readonly string $notificationUuid,
        public readonly ?array $subscriptionIds = null,
        public readonly int $attempt = 1,
        public readonly ?array $expoTokenIds = null,
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

    public function handle(PushSender $sender, MobilePushSender $mobileSender): void
    {
        $notification = AppNotification::query()->withoutGlobalScopes()->where('uuid', $this->notificationUuid)->first();
        $type = NotificationType::tryFrom((string) $notification?->type);
        $user = $notification ? User::query()->find($notification->user_id) : null;

        if (! $notification || $notification->read_at !== null || ! $user) {
            return;
        }

        if ($type === null) {
            Log::warning('Push skipped: notification with unknown type.', [
                'notification' => $this->notificationUuid,
            ]);

            return;
        }

        if (! $user->wantsPush($type)) {
            return;
        }

        $subscriptions = $this->subscriptionIds === [] ? collect() : $user->pushSubscriptions()
            ->when($this->subscriptionIds !== null, fn ($query) => $query->whereKey($this->subscriptionIds))
            ->orderBy('id')
            ->get();

        // Unset in a job queued before Expo push existed: reading it directly would throw.
        $expoTokenIds = $this->expoTokenIds ?? null;

        $expoTokens = $expoTokenIds === [] ? collect() : $user->expoPushTokens()
            ->when($expoTokenIds !== null, fn ($query) => $query->whereKey($expoTokenIds))
            ->orderBy('id')
            ->get();

        if ($subscriptions->isEmpty() && $expoTokens->isEmpty()) {
            return;
        }

        $webPayload = PushPayload::for($notification, $user);

        if ($webPayload === null) {
            Log::warning('Push skipped: notification with unknown type or incomplete data.', [
                'notification' => $this->notificationUuid,
            ]);

            return;
        }

        $failedSubscriptions = [];
        $failedExpoTokens = [];

        if ($subscriptions->isNotEmpty() && $this->webPushConfigured()) {
            try {
                $failedSubscriptions = $this->settle($sender->send($subscriptions, $webPayload), PushSubscription::class, 'subscriptions');
            } catch (Throwable $e) {
                report($e);
            }
        }

        if ($expoTokens->isNotEmpty()) {
            try {
                $failedExpoTokens = $this->settle(
                    $mobileSender->send($expoTokens, PushPayload::mobile($notification, $user)),
                    ExpoPushToken::class,
                    'expo_tokens',
                );
            } catch (Throwable $e) {
                report($e);
            }
        }

        $this->retry($failedSubscriptions, $failedExpoTokens);
    }

    private function webPushConfigured(): bool
    {
        $missing = array_values(array_filter(
            self::VAPID_SETTINGS,
            fn (string $env, string $key) => blank(config("workspace.push.{$key}")),
            ARRAY_FILTER_USE_BOTH,
        ));

        if ($missing !== []) {
            Log::warning('Web Push is not configured, push skipped: missing '.implode(', ', $missing).'.', [
                'notification' => $this->notificationUuid,
            ]);
        }

        return $missing === [];
    }

    /**
     * @param  array<int, string>  $results
     * @param  class-string<PushSubscription|ExpoPushToken>  $model
     * @return list<int> ids that failed and are worth retrying
     */
    private function settle(array $results, string $model, string $logKey): array
    {
        $byOutcome = collect($results)->groupBy(fn (string $outcome) => $outcome, preserveKeys: true)
            ->map(fn ($group) => $group->keys()->all());

        if ($sent = $byOutcome->get(PushSender::SENT)) {
            $model::query()->whereKey($sent)->update(['last_used_at' => now()]);
        }

        if ($expired = $byOutcome->get(PushSender::EXPIRED)) {
            $model::query()->whereKey($expired)->delete();
        }

        if ($rejected = $byOutcome->get(PushSender::REJECTED)) {
            Log::warning('Push rejected by the push service.', [
                'notification' => $this->notificationUuid,
                $logKey => $rejected,
            ]);
        }

        return $byOutcome->get(PushSender::FAILED, []);
    }

    /**
     * @param  list<int>  $failedSubscriptions
     * @param  list<int>  $failedExpoTokens
     */
    private function retry(array $failedSubscriptions, array $failedExpoTokens): void
    {
        if ($failedSubscriptions === [] && $failedExpoTokens === []) {
            return;
        }

        if ($this->attempt >= self::MAX_ATTEMPTS) {
            Log::warning('Push gave up after '.self::MAX_ATTEMPTS.' attempts.', array_filter([
                'notification' => $this->notificationUuid,
                'subscriptions' => $failedSubscriptions,
                'expo_tokens' => $failedExpoTokens,
            ], fn ($value) => $value !== []));

            return;
        }

        static::dispatch($this->notificationUuid, $failedSubscriptions, $this->attempt + 1, $failedExpoTokens)
            ->delay(self::RETRY_DELAYS[$this->attempt - 1]);
    }
}
