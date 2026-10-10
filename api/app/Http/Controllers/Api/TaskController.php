<?php

namespace App\Http\Controllers\Api;

use App\Enums\TaskStatus;
use App\Events\TaskCreated;
use App\Events\TaskDeleted;
use App\Events\TaskUpdated;
use App\Http\Controllers\Controller;
use App\Http\Requests\Task\DeleteTaskRequest;
use App\Http\Requests\Task\MoveTaskRequest;
use App\Http\Requests\Task\StoreTaskRequest;
use App\Http\Requests\Task\UpdateTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Project;
use App\Models\Task;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class TaskController extends Controller
{
    public const RELATIONS = ['assignee:id,name', 'logGroup:id,level,title,status,events_count'];

    /** Below this gap between neighbors the column is renumbered instead of halving it again. */
    private const MIN_POSITION_GAP = 1e-9;

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
        TaskCreated::dispatch($task);

        return (new TaskResource($task))->response()->setStatusCode(201);
    }

    public function update(UpdateTaskRequest $request, Project $project, Task $task): TaskResource
    {
        abort_unless($task->project_id === $project->id, 404);

        $data = $request->validated();

        $task->fill(array_intersect_key($data, array_flip(['title', 'description'])));
        if (array_key_exists('assignee_id', $data)) {
            $task->assignee_id = $data['assignee_id'];
        }
        $task->save();

        $task->load(self::RELATIONS)->setRelation('project', $project);
        TaskUpdated::dispatch($task);

        return new TaskResource($task);
    }

    public function destroy(DeleteTaskRequest $request, Project $project, Task $task): Response
    {
        abort_unless($task->project_id === $project->id, 404);

        $task->delete();
        TaskDeleted::dispatch($task);

        return response()->noContent();
    }

    public function move(MoveTaskRequest $request, Project $project, Task $task): TaskResource
    {
        abort_unless($task->project_id === $project->id, 404);

        $status = $request->taskStatus();
        $beforeId = $request->beforeId();
        $afterId = $request->afterId();

        $task = DB::transaction(function () use ($project, $task, $status, $beforeId, $afterId) {
            // Same lock as store() takes with its UPDATE: creations and moves of the project are serialized, so no
            // task enters the target column while it is read. NO KEY keeps inserts that reference the project free.
            DB::table('projects')->where('id', $project->id)->lock('for no key update')->first();

            $task = Task::query()->whereKey($task->id)->lockForUpdate()->firstOrFail();

            $column = Task::query()
                ->where('project_id', $project->id)
                ->where('status', $status)
                ->whereKeyNot($task->id)
                ->orderBy('position')
                ->orderBy('id')
                ->lockForUpdate()
                ->get(['id', 'position'])
                ->values();

            $slot = $this->moveSlot($column, $beforeId, $afterId);

            $previous = $column[$slot - 1] ?? null;
            $next = $column[$slot] ?? null;
            $position = match (true) {
                $previous === null && $next === null => 1.0,
                $previous === null => $next->position - 1.0,
                $next === null => $previous->position + 1.0,
                default => ($previous->position + $next->position) / 2,
            };

            if ($previous !== null && $next !== null && (
                $next->position - $previous->position <= self::MIN_POSITION_GAP
                || $position <= $previous->position
                || $position >= $next->position
            )) {
                $position = $this->renumberColumn($column, $slot);
            }

            $task->status = $status;
            $task->position = $position;
            $task->save();

            return $task;
        });

        $task->load(self::RELATIONS)->setRelation('project', $project);
        TaskUpdated::dispatch($task);

        return new TaskResource($task);
    }

    /**
     * Index in the target column (without the moved task) where the task goes; validates that the neighbors are in
     * that column and, when both come, that nothing sits between them.
     *
     * @param  Collection<int, Task>  $column
     */
    private function moveSlot(Collection $column, ?int $beforeId, ?int $afterId): int
    {
        $index = fn (int $id) => $column->search(fn (Task $neighbor) => $neighbor->id === $id);

        $afterIndex = $afterId === null ? null : $index($afterId);
        $beforeIndex = $beforeId === null ? null : $index($beforeId);

        foreach (['after_id' => $afterIndex, 'before_id' => $beforeIndex] as $field => $found) {
            if ($found === false) {
                throw ValidationException::withMessages([
                    $field => __('The neighbor task is not in the target column of this project.'),
                ]);
            }
        }

        if ($afterIndex !== null && $beforeIndex !== null && $beforeIndex !== $afterIndex + 1) {
            throw ValidationException::withMessages([
                'before_id' => __('The neighbor tasks are not next to each other.'),
            ]);
        }

        return match (true) {
            $afterIndex !== null => $afterIndex + 1,
            $beforeIndex !== null => $beforeIndex,
            default => $column->count(),
        };
    }

    /**
     * Spreads the column over 1, 2, 3... leaving the moved task's slot free, and returns the position of that slot.
     *
     * @param  Collection<int, Task>  $column
     */
    private function renumberColumn(Collection $column, int $slot): float
    {
        foreach ($column as $index => $neighbor) {
            $position = (float) ($index < $slot ? $index + 1 : $index + 2);
            if ((float) $neighbor->position !== $position) {
                DB::table('tasks')->where('id', $neighbor->id)->update(['position' => $position]);
            }
        }

        return (float) ($slot + 1);
    }
}
