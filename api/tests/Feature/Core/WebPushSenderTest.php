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
