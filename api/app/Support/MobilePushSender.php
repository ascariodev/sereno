<?php

namespace App\Support;

use App\Models\ExpoPushToken;

/** Push to the mobile app. Outcomes reuse the PushSender constants so the job settles both channels alike. */
interface MobilePushSender
{
    /**
     * @param  iterable<ExpoPushToken>  $tokens
     * @param  array{title: string, body: string, data?: array<string, mixed>}  $message
     * @return array<int, PushSender::SENT|PushSender::EXPIRED|PushSender::FAILED|PushSender::REJECTED> keyed by token id
     */
    public function send(iterable $tokens, array $message): array;
}
