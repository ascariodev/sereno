<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\URL;

class MessageAttachment extends Model
{
    use BelongsToOrganization;

    public const UPDATED_AT = null;

    // The expiry is rounded up to this step so the same file keeps the same url (and browser cache) for a while.
    public const URL_EXPIRY_STEP_SECONDS = 600;

    protected $guarded = ['*'];

    protected function casts(): array
    {
        return [
            'size' => 'integer',
        ];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(Channel::class);
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    /**
     * The signature covers only the path and query, so it validates the same behind the proxy whatever host or
     * scheme the request arrives with; the host always comes from APP_URL, also in the queue worker.
     */
    public function downloadUrl(): string
    {
        $earliest = now()->addMinutes(config('chat.attachments.url_ttl_minutes'))->getTimestamp();
        $step = self::URL_EXPIRY_STEP_SECONDS;

        $path = URL::temporarySignedRoute(
            'attachments.download',
            Carbon::createFromTimestamp(intdiv($earliest + $step - 1, $step) * $step),
            ['attachment' => $this->id],
            absolute: false,
        );

        return rtrim(config('app.url'), '/').$path;
    }
}
