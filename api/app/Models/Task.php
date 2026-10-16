<?php

namespace App\Models;

use App\Enums\TaskStatus;
use App\Events\TaskUpdated;
use App\Http\Controllers\Api\TaskController;
use App\Models\Concerns\BelongsToOrganization;
use App\Models\Concerns\EnsuresProjectInOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['title', 'description', 'status', 'position', 'assignee_id'])]
class Task extends Model
{
    use BelongsToOrganization, EnsuresProjectInOrganization;

    public const TITLE_MAX_LENGTH = 200;

    public const DESCRIPTION_MAX_LENGTH = 10000;

    public const RELATIONS = ['assignee:id,name', 'logGroup:id,level,title,status,events_count'];

    protected function casts(): array
    {
        return [
            'status' => TaskStatus::class,
            'number' => 'integer',
            'position' => 'float',
        ];
    }

    /**
     * Clears the user's assignments in one UPDATE and broadcasts each changed task to its project channel. Tasks are
     * read first (locked) with what TaskUpdated needs, so the broadcast costs no query per task.
     */
    public static function unassignUser(int $organizationId, int $userId, ?int $projectId = null): void
    {
        $tasks = static::withoutGlobalScopes()
            ->where('organization_id', $organizationId)
            ->where('assignee_id', $userId)
            ->when($projectId !== null, fn ($query) => $query->where('project_id', $projectId))
            ->with(Task::RELATIONS)
            ->withCount(TaskController::counts())
            ->lockForUpdate()
            ->get();

        if ($tasks->isEmpty()) {
            return;
        }

        $projects = Project::withoutGlobalScopes()->whereKey($tasks->pluck('project_id')->unique())->get()->keyBy('id');

        static::withoutGlobalScopes()->whereKey($tasks->modelKeys())->update(['assignee_id' => null, 'updated_at' => now()]);

        foreach ($tasks as $task) {
            $task->forceFill(['assignee_id' => null, 'updated_at' => now()])->syncOriginal();
            $task->setRelation('assignee', null)->setRelation('project', $projects[$task->project_id]);
            TaskUpdated::dispatch($task);
        }
    }

    public function key(): string
    {
        return $this->project->key.'-'.$this->number;
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function logGroup(): BelongsTo
    {
        return $this->belongsTo(LogGroup::class);
    }

    public function comments(): HasMany
    {
        return $this->hasMany(TaskComment::class);
    }
}
