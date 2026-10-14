<?php

use App\Models\PushSubscription;
use App\Support\PushSender;
use App\Support\WebPushSender;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\VAPID;

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
