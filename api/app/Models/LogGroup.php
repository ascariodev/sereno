<?php

namespace App\Models;

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Models\Concerns\BelongsToOrganization;
use App\Models\Concerns\EnsuresProjectInOrganization;
use Database\Factories\LogGroupFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['fingerprint', 'level', 'title', 'status', 'first_seen_at', 'last_seen_at', 'events_count'])]
class LogGroup extends Model
{
    /** @use HasFactory<LogGroupFactory> */
    use BelongsToOrganization, EnsuresProjectInOrganization, HasFactory;

    public const TITLE_MAX_LENGTH = 255;

    protected function casts(): array
    {
        return [
            'level' => LogLevel::class,
            'status' => LogGroupStatus::class,
            'first_seen_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'events_count' => 'integer',
        ];
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }
}
