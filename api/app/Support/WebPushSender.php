<?php

namespace App\Support;

use ErrorException;
use Minishlink\WebPush\MessageSentReport;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

class WebPushSender implements PushSender
{
    public function send(iterable $subscriptions, string $payload): array
    {
        $webPush = new WebPush(['VAPID' => [
            'subject' => config('workspace.push.vapid_subject'),
            'publicKey' => config('workspace.push.vapid_public_key'),
            'privateKey' => config('workspace.push.vapid_private_key'),
        ]]);

        $results = [];

        foreach ($subscriptions as $subscription) {
            try {
                $report = $webPush->sendOneNotification(Subscription::create([
                    'endpoint' => $subscription->endpoint,
                    'publicKey' => $subscription->public_key,
                    'authToken' => $subscription->auth_token,
                    'contentEncoding' => $subscription->content_encoding,
                ]), $payload);
            } catch (ErrorException $e) {
                report($e);
                $results[$subscription->id] = self::REJECTED;

                continue;
            }

            $results[$subscription->id] = $this->outcome($report);
        }

        return $results;
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
