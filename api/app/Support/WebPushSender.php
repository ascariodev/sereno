<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\MessageSentReport;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use Throwable;

class WebPushSender implements PushSender
{
    public function send(iterable $subscriptions, string $payload): array
    {
        $webPush = $this->makeWebPush();

        $results = [];

        foreach ($subscriptions as $subscription) {
            try {
                $report = $webPush->sendOneNotification(Subscription::create([
                    'endpoint' => $subscription->endpoint,
                    'publicKey' => $subscription->public_key,
                    'authToken' => $subscription->auth_token,
                    'contentEncoding' => $subscription->content_encoding,
                ]), $payload);
            } catch (Throwable $e) {
                Log::warning('Push could not be sent to a subscription.', [
                    'subscription' => $subscription->id,
                    'host' => parse_url($subscription->endpoint, PHP_URL_HOST) ?: null,
                    'exception' => $e::class.': '.str_replace($subscription->endpoint, '[endpoint]', $e->getMessage()),
                ]);
                $results[$subscription->id] = self::REJECTED;

                continue;
            }

            $results[$subscription->id] = $this->outcome($report);
        }

        return $results;
    }

    protected function makeWebPush(): WebPush
    {
        return new WebPush(['VAPID' => [
            'subject' => config('workspace.push.vapid_subject'),
            'publicKey' => config('workspace.push.vapid_public_key'),
            'privateKey' => config('workspace.push.vapid_private_key'),
        ]]);
    }

    private function outcome(MessageSentReport $report): string
    {
        if ($report->isSuccess()) {
            return self::SENT;
        }

        if ($report->isSubscriptionExpired()) {
            return self::EXPIRED;
        }

        $status = $report->getResponse()?->getStatusCode();

        return $status === null || $status === 429 || $status >= 500 ? self::FAILED : self::REJECTED;
    }
}
