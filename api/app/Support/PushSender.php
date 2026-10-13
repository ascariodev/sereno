<?php

namespace App\Support;

use App\Models\PushSubscription;

interface PushSender
{
    public const SENT = 'sent';

    public const EXPIRED = 'expired';

    /** Network error, 429 or 5xx: worth retrying later. */
    public const FAILED = 'failed';

    /** Any other refusal (400, 413...): sending again would get the same answer. */
    public const REJECTED = 'rejected';

    /**
     * @param  iterable<PushSubscription>  $subscriptions
     * @return array<int, self::SENT|self::EXPIRED|self::FAILED|self::REJECTED> keyed by subscription id
     */
    public function send(iterable $subscriptions, string $payload): array;
}
