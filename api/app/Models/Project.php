<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'key', 'description'])]
class Project extends Model
{
    /** @use HasFactory<ProjectFactory> */
    use BelongsToOrganization, HasFactory;

    protected function casts(): array
    {
        return [
            'archived_at' => 'datetime',
        ];
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }

    public function logSources(): HasMany
    {
        return $this->hasMany(LogSource::class);
    }
}
