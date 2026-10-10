<?php

namespace App\Http\Controllers\Api;

use App\Enums\TaskStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\TaskResource;
use App\Models\Project;
use App\Models\Task;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class TaskController extends Controller
{
    public function index(Project $project): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Task::class);

        $order = 'CASE status';
        foreach (TaskStatus::cases() as $index => $status) {
            $order .= " WHEN '{$status->value}' THEN {$index}";
        }

        $tasks = Task::query()
            ->where('project_id', $project->id)
            ->with(['assignee:id,name', 'logGroup:id,level,title,status,events_count'])
            ->orderByRaw($order.' END')
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        // key() reads the project: share the one already loaded instead of one query per task.
        $tasks->each(fn (Task $task) => $task->setRelation('project', $project));

        return TaskResource::collection($tasks);
    }
}
