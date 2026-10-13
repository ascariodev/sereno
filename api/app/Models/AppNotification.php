<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class AppNotification extends Model
{
    use BelongsToOrganization;

    public const UPDATED_AT = null;

    protected $table = 'notifications';

    protected $guarded = ['*'];

    protected function casts(): array
    {
        return [
            'data' => 'array',
            'read_at' => 'datetime',
        ];
    }

    /** @param  list<int>  $subjectIds */
    public static function forgetSubjects(string $subjectType, array $subjectIds): void
    {
        if ($subjectIds === []) {
            return;
        }

        static::query()
            ->withoutGlobalScopes()
            ->where('subject_type', $subjectType)
            ->whereIn('subject_id', $subjectIds)
            ->delete();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function subject(): MorphTo
    {
        return $this->morphTo();
    }
}
