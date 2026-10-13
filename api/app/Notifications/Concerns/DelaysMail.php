<?php

namespace App\Notifications\Concerns;

use App\Models\AppNotification;
use DateTimeInterface;

trait DelaysMail
{
    /** @return array<string, DateTimeInterface|int|null> */
    public function withDelay(object $notifiable, string $channel): array
    {
        return $channel === 'mail' ? ['mail' => now()->addMinutes(max(0, (int) config('workspace.notifications.mail_delay_minutes')))] : [];
    }

    protected function readInInbox(object $notifiable, string $channel): bool
    {
        return $channel === 'mail'
            && AppNotification::query()
                ->withoutGlobalScopes()
                ->where('uuid', $this->id)
                ->where('user_id', $notifiable->id)
                ->whereNotNull('read_at')
                ->exists();
    }
}
