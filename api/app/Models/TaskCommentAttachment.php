<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\URL;

class TaskCommentAttachment extends Model
{
    use BelongsToOrganization;

    public const UPDATED_AT = null;

    protected $guarded = ['*'];

    protected function casts(): array
    {
        return [
            'size' => 'integer',
        ];
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function comment(): BelongsTo
    {
        return $this->belongsTo(TaskComment::class, 'task_comment_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function downloadUrl(): string
    {
        return $this->signedDownload()['url'];
    }

    /**
     * Same expiry rounding and relative signature on APP_URL as MessageAttachment::signedDownload.
     *
     * @return array{url: string, expires_at: Carbon}
     */
    public function signedDownload(): array
    {
        $earliest = now()->addMinutes(config('chat.attachments.url_ttl_minutes'))->getTimestamp();
        $step = MessageAttachment::URL_EXPIRY_STEP_SECONDS;
        $expiresAt = Carbon::createFromTimestampUTC(intdiv($earliest + $step - 1, $step) * $step);

        $path = URL::temporarySignedRoute(
            'task-attachments.download',
            $expiresAt,
            ['attachment' => $this->id],
            absolute: false,
        );

        return ['url' => rtrim(config('app.url'), '/').$path, 'expires_at' => $expiresAt];
    }
}
