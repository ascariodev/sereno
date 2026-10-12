<?php

namespace App\Models\Concerns;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\URL;

trait HasSignedDownload
{
    // The expiry is rounded up to this step so the same file keeps the same url (and browser cache) for a while.
    public const URL_EXPIRY_STEP_SECONDS = 60;

    abstract protected function downloadRouteName(): string;

    /**
     * The signature covers only the path and query, so it validates the same behind the proxy whatever host or
     * scheme the request arrives with; the host always comes from APP_URL, also in the queue worker.
     */
    public function downloadUrl(): string
    {
        return $this->signedDownload()['url'];
    }

    /**
     * @return array{url: string, expires_at: Carbon}
     */
    public function signedDownload(): array
    {
        $earliest = now()->addMinutes(config('chat.attachments.url_ttl_minutes'))->getTimestamp();
        $step = self::URL_EXPIRY_STEP_SECONDS;
        $expiresAt = Carbon::createFromTimestampUTC(intdiv($earliest + $step - 1, $step) * $step);

        $path = URL::temporarySignedRoute(
            $this->downloadRouteName(),
            $expiresAt,
            ['attachment' => $this->id],
            absolute: false,
        );

        return ['url' => rtrim(config('app.url'), '/').$path, 'expires_at' => $expiresAt];
    }
}
