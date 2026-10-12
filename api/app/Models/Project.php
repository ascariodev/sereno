<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

#[Fillable(['name', 'key', 'description', 'tasks_resolve_log_groups'])]
class Project extends Model
{
    /** @use HasFactory<ProjectFactory> */
    use BelongsToOrganization, HasFactory;

    protected $attributes = ['tasks_resolve_log_groups' => false];

    protected static function booted(): void
    {
        static::updating(function (Project $project) {
            if (! $project->isDirty('organization_id')) {
                return;
            }

            $hasSources = LogSource::query()->withoutGlobalScopes()->where('project_id', $project->getKey())->exists();
            $hasGroups = LogGroup::query()->withoutGlobalScopes()->where('project_id', $project->getKey())->exists();

            $hasTasks = Task::query()->withoutGlobalScopes()->where('project_id', $project->getKey())->exists();
            $hasMembers = DB::table('project_user')->where('project_id', $project->getKey())->exists();

            if ($hasSources || $hasGroups || $hasTasks || $hasMembers) {
                throw new InvalidArgumentException('A project with log sources, groups, tasks or members cannot change organization.');
            }
        });
    }

    protected function casts(): array
    {
        return [
            'archived_at' => 'datetime',
            'tasks_resolve_log_groups' => 'boolean',
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

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class)->withPivot('organization_id')->withTimestamps();
    }

    /** True when the user was not assigned yet. */
    public function addMember(User $user): bool
    {
        $changes = $this->members()->syncWithoutDetaching([
            $user->getKey() => ['organization_id' => $this->organization_id],
        ]);

        return $changes['attached'] !== [];
    }

    /** True when the user was assigned. */
    public function removeMember(User $user): bool
    {
        return $this->members()->detach($user->getKey()) > 0;
    }
}
