<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LogEventReceipt extends Model
{
    use BelongsToOrganization;

    public const CREATED_AT = 'received_at';

    public const UPDATED_AT = null;

    public const RETRY_WINDOW_HOURS = 48;

    protected $guarded = ['*'];

    protected function casts(): array
    {
        return [
            'received_at' => 'datetime',
        ];
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(LogSource::class, 'log_source_id');
    }
}
