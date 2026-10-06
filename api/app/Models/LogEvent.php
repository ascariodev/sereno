<?php

namespace App\Models;

use App\Enums\LogLevel;
use App\Models\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Rows live in daily partitions of received_at: the partition for the day must exist
 * (LogPartitions::ensure) before inserting. The real primary key is (id, received_at);
 * id alone is unique in practice because it comes from a single identity sequence.
 */
#[Fillable(['level', 'message', 'context', 'occurred_at', 'received_at'])]
class LogEvent extends Model
{
    use BelongsToOrganization;

    public const CREATED_AT = 'received_at';

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'level' => LogLevel::class,
            'context' => 'array',
            'occurred_at' => 'datetime',
            'received_at' => 'datetime',
        ];
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(LogGroup::class, 'log_group_id');
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(LogSource::class, 'log_source_id');
    }
}
