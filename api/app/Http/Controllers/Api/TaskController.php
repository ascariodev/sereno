<?php

namespace App\Http\Controllers\Api;

use App\Enums\TaskStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Task\StoreTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Project;
use App\Models\Task;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class TaskController extends Controller
{
    private const RELATIONS = ['assignee:id,name', 'logGroup:id,level,title,status,events_count'];

    public function index(Project $project): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Task::class);

        $order = 'CASE status';
        foreach (TaskStatus::cases() as $index => $status) {
            $order .= " WHEN '{$status->value}' THEN {$index}";
        }

        $tasks = Task::query()
            ->where('project_id', $project->id)
            ->with(self::RELATIONS)
            ->orderByRaw($order.' END')
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        // key() reads the project: share the one already loaded instead of one query per task.
        $tasks->each(fn (Task $task) => $task->setRelation('project', $project));

        return TaskResource::collection($tasks);
    }

    public function store(StoreTaskRequest $request, Project $project): JsonResponse
    {
        $status = $request->taskStatus();

        try {
            $task = DB::transaction(function () use ($request, $project, $status) {
                // Locks the project row until commit, so numbers and positions of the project are serialized.
                $number = DB::selectOne(
                    'UPDATE projects SET last_task_number = last_task_number + 1 WHERE id = ? RETURNING last_task_number',
                    [$project->id],
                )->last_task_number;

                $last = Task::query()
                    ->where('project_id', $project->id)
                    ->where('status', $status)
                    ->max('position');

                $task = new Task([
                    'title' => $request->validated('title'),
                    'description' => $request->validated('description'),
                    'status' => $status,
                    'position' => $last === null ? 1.0 : (float) $last + 1.0,
                ]);
                $task->project_id = $project->id;
                $task->number = (int) $number;
                $task->assignee_id = $request->validated('assignee_id');
                $task->log_group_id = $request->validated('log_group_id');
                $task->created_by = $request->user()->id;
                $task->save();

                return $task;
            });
        } catch (UniqueConstraintViolationException) {
            // Another request linked the same log group between validation and insert.
            throw ValidationException::withMessages([
                'log_group_id' => __('The log group already has a task.'),
            ]);
        }

        $task->load(self::RELATIONS)->setRelation('project', $project);

        return (new TaskResource($task))->response()->setStatusCode(201);
    }
}
