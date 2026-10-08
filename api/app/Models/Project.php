<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use InvalidArgumentException;

#[Fillable(['name', 'key', 'description'])]
class Project extends Model
{
    /** @use HasFactory<ProjectFactory> */
    use BelongsToOrganization, HasFactory;

    protected static function booted(): void
    {
        static::updating(function (Project $project) {
            if (! $project->isDirty('organization_id')) {
                return;
            }

            $hasSources = LogSource::query()->withoutGlobalScopes()->where('project_id', $project->getKey())->exists();
            $hasGroups = LogGroup::query()->withoutGlobalScopes()->where('project_id', $project->getKey())->exists();

            if ($hasSources || $hasGroups) {
                throw new InvalidArgumentException('A project with log sources or groups cannot change organization.');
            }
        });
    }

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

    public function logSourceCreationError(): ?string
    {
        return $this->isArchived()
            ? __('This project is archived and cannot have new log sources.')
            : null;
    }

    public function channel(): HasOne
    {
        return $this->hasOne(Channel::class);
    }

    public function logSources(): HasMany
    {
        return $this->hasMany(LogSource::class);
    }

    public function logGroups(): HasMany
    {
        return $this->hasMany(LogGroup::class);
    }
}
