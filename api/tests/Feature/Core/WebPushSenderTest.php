<?php

use App\Models\PushSubscription;
use App\Support\PushSender;
use App\Support\WebPushSender;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\MessageSentReport;
use Minishlink\WebPush\SubscriptionInterface;
use Minishlink\WebPush\VAPID;
use Minishlink\WebPush\WebPush;

it('rejects each subscription whose delivery throws and keeps going with the rest', function () {
    Log::spy();
    $keys = VAPID::createVapidKeys();
    config([
        'workspace.push.vapid_public_key' => $keys['publicKey'],
        'workspace.push.vapid_private_key' => $keys['privateKey'],
        'workspace.push.vapid_subject' => 'mailto:ops@sereno.test',
    ]);
    $subscriptions = PushSubscription::factory()->count(2)->make(['public_key' => 'not-a-key'])
        ->each(fn (PushSubscription $subscription, int $index) => $subscription->id = $index + 1);

    $results = (new WebPushSender)->send($subscriptions, '{}');

    expect($results)->toBe([1 => PushSender::REJECTED, 2 => PushSender::REJECTED]);
    Log::shouldHaveReceived('warning')->twice();
});

it('logs only the host of a rejected endpoint, never its token', function () {
    Log::spy();
    $keys = VAPID::createVapidKeys();
    config([
        'workspace.push.vapid_public_key' => $keys['publicKey'],
        'workspace.push.vapid_private_key' => $keys['privateKey'],
        'workspace.push.vapid_subject' => 'mailto:ops@sereno.test',
    ]);
    $subscription = PushSubscription::factory()->make([
        'endpoint' => 'https://push.example.test/send/secret-token-123',
        'public_key' => 'not-a-key',
    ]);
    $subscription->id = 1;

    (new WebPushSender)->send([$subscription], '{}');

    Log::shouldHaveReceived('warning')->withArgs(
        fn (string $message, array $context) => $context['host'] === 'push.example.test'
            && ! str_contains(json_encode($context), 'secret-token-123')
    )->once();
});

it('redacts the full endpoint from a delivery exception message before logging it', function () {
    Log::spy();
    $endpoint = 'https://push.example.test/send/secret-token-456';
    $sender = new class extends WebPushSender
    {
        protected function makeWebPush(): WebPush
        {
            return new class extends WebPush
            {
                public function __construct() {}

                public function sendOneNotification(SubscriptionInterface $subscription, ?string $payload = null, array $options = [], array $auth = []): MessageSentReport
                {
                    throw new RuntimeException('Server error for '.$subscription->getEndpoint().' (500)');
                }
            };
        }
    };
    $subscription = PushSubscription::factory()->make(['endpoint' => $endpoint]);
    $subscription->id = 1;

    $results = $sender->send([$subscription], '{}');

    expect($results)->toBe([1 => PushSender::REJECTED]);
    Log::shouldHaveReceived('warning')->withArgs(
        fn (string $message, array $context) => ! str_contains(json_encode($context), 'secret-token-456')
            && str_contains($context['exception'], 'Server error for [endpoint] (500)')
    )->once();
});
