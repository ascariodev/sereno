<?php

namespace App\Http\Controllers\Api;

use App\Actions\DeleteTask;
use App\Actions\PostLogGroupStatusNotice;
use App\Enums\LogGroupStatus;
use App\Enums\TaskStatus;
use App\Events\TaskAssigned;
use App\Events\TaskCreated;
use App\Events\TaskDeleted;
use App\Events\TaskUpdated;
use App\Http\Controllers\Controller;
use App\Http\Requests\Task\DeleteTaskRequest;
use App\Http\Requests\Task\MoveTaskRequest;
use App\Http\Requests\Task\StoreTaskRequest;
use App\Http\Requests\Task\UpdateTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\ProjectAccess;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class TaskController extends Controller
{
    public const RELATIONS = ['assignee:id,name', 'logGroup:id,level,title,status,events_count'];

    /**
     * Counts loaded next to RELATIONS wherever a TaskResource is built. Comments are counted without their organization
     * scope (it needs an active organization, and Task::unassignUser runs without one): the composite foreign key
     * already ties each comment to the organization of its task.
     *
     * @return array<string, Closure(Builder): Builder>
     */
    public static function counts(): array
    {
        return ['comments' => fn (Builder $query) => $query->withoutGlobalScopes()];
    }

    /** Below this gap between neighbors the column is renumbered instead of halving it again. */
    private const MIN_POSITION_GAP = 1e-9;

    /** Done tasks listed when the board asks for a bounded Done column (`done_limit`). */
    public const MAX_DONE_LIMIT = 500;

    public function index(Request $request, Project $project): AnonymousResourceCollection
    {
        Gate::authorize('view', $project);

        $doneLimit = $request->validate([
            'done_limit' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_DONE_LIMIT],
        ])['done_limit'] ?? null;

        $cases = array_values(array_filter(TaskStatus::cases(), fn (TaskStatus $status) => $status !== TaskStatus::Done));
        $order = 'CASE status'.str_repeat(' WHEN ? THEN ?', count($cases)).' END';
        $bindings = [];
        foreach ($cases as $index => $status) {
            array_push($bindings, $status->value, $index);
        }

        $active = Task::query()
            ->where('project_id', $project->id)
            ->where('status', '!=', TaskStatus::Done)
            ->with(self::RELATIONS)
            ->withCount(self::counts())
            ->orderByRaw($order, $bindings)
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        $doneQuery = Task::query()
            ->where('project_id', $project->id)
            ->where('status', TaskStatus::Done);
        $doneTotal = (clone $doneQuery)->count();

        // New and moved tasks land at the end of the column, so the last ones by position are the most recent. The
        // cut is contiguous, which keeps drag & drop neighbors adjacent; it is returned in column order.
        $done = $doneQuery
            ->with(self::RELATIONS)
            ->withCount(self::counts())
            ->orderByDesc('position')
            ->orderByDesc('id')
            ->when($doneLimit !== null, fn ($query) => $query->limit($doneLimit))
            ->get()
            ->reverse()
            ->values();

        $tasks = $active->concat($done)->values();

        // key() reads the project: share the one already loaded instead of one query per task.
        $tasks->each(fn (Task $task) => $task->setRelation('project', $project));

        return TaskResource::collection($tasks)->additional(['meta' => [
            'done_total' => $doneTotal,
            'has_more_done' => $done->count() < $doneTotal,
        ]]);
    }

    public function show(Project $project, Task $task): TaskResource
    {
        Gate::authorize('view', $project);
        abort_unless($task->project_id === $project->id, 404);
        Gate::authorize('view', $task);

        $task->load(self::RELATIONS)->loadCount(self::counts())->setRelation('project', $project);

        return new TaskResource($task);
    }

    public function store(StoreTaskRequest $request, Project $project): JsonResponse
    {
        $status = $request->taskStatus();

        try {
            $task = DB::transaction(function () use ($request, $project, $status) {
                $this->lockAssigneeAccess($project, $request->validated('assignee_id'));
                $this->lockActiveProject($project, __('This project is archived and cannot have new tasks.'));

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

                if ($task->log_group_id !== null) {
                    $task->setRelation('project', $project);
                    $this->postTaskCreatedNotice($project, $task);
                }

                return $task;
            });
        } catch (UniqueConstraintViolationException $exception) {
            if (! str_contains($exception->getMessage(), 'tasks_log_group_id_unique')) {
                throw $exception;
            }

            // Another request linked the same log group between validation and insert.
            throw ValidationException::withMessages([
                'log_group_id' => __('The log group already has a task.'),
            ]);
        }

        $task->load(self::RELATIONS)->loadCount(self::counts())->setRelation('project', $project);
        TaskCreated::dispatch($task);
        $this->notifyAssignee($task, $request->user()->id);

        return (new TaskResource($task))->response()->setStatusCode(201);
    }

    private function postTaskCreatedNotice(Project $project, Task $task): void
    {
        $channel = Channel::query()
            ->where('project_id', $project->id)
            ->whereNull('archived_at')
            ->first();

        if ($channel === null) {
            return;
        }

        $message = new Message([
            'kind' => Message::KIND_SYSTEM,
            'payload' => [
                'type' => 'task.created_from_group',
                'log_group_id' => $task->log_group_id,
                'task_id' => $task->id,
                'task_key' => $task->key(),
                'task_status' => $task->status->value,
            ],
        ]);
        $message->forceFill([
            'organization_id' => $task->organization_id,
            'channel_id' => $channel->id,
            'user_id' => $task->created_by,
            'log_group_id' => $task->log_group_id,
        ])->save();
    }

    public function update(UpdateTaskRequest $request, Project $project, Task $task): TaskResource
    {
        $data = $request->validated();
        $newAssigneeId = array_key_exists('assignee_id', $data) && $data['assignee_id'] !== null
            && (int) $data['assignee_id'] !== $task->assignee_id ? (int) $data['assignee_id'] : null;

        DB::transaction(function () use ($project, $task, $data, $newAssigneeId) {
            $this->lockAssigneeAccess($project, $newAssigneeId);
            $this->lockActiveProject($project, __('This project is archived and its tasks cannot be edited.'));
            $task->fill($data)->save();
        });

        $task->load(self::RELATIONS)->loadCount(self::counts())->setRelation('project', $project);
        TaskUpdated::dispatch($task);
        if ($newAssigneeId !== null) {
            $this->notifyAssignee($task, $request->user()->id);
        }

        return new TaskResource($task);
    }

    private function notifyAssignee(Task $task, int $actorId): void
    {
        if ($task->assignee_id === null || $task->assignee_id === $actorId) {
            return;
        }

        TaskAssigned::dispatch($task->assignee_id, $task->organization_id, $task->project_id, $task->id);
    }

    public function destroy(DeleteTaskRequest $request, Project $project, Task $task, DeleteTask $deleteTask): Response
    {
        abort_unless($task->project_id === $project->id, 404);

        $deleteTask($task);
        TaskDeleted::dispatch($task);

        return response()->noContent();
    }

    public function move(MoveTaskRequest $request, Project $project, Task $task, PostLogGroupStatusNotice $postGroupNotice): TaskResource
    {
        abort_unless($task->project_id === $project->id, 404);

        $status = $request->taskStatus();
        $beforeId = $request->beforeId();
        $afterId = $request->afterId();
        $actor = $request->user();

        $renumbered = [];

        $task = DB::transaction(function () use ($project, $task, $status, $beforeId, $afterId, $actor, $postGroupNotice, &$renumbered) {
            // Same lock as store() takes with its UPDATE: creations and moves of the project are serialized, so no
            // task enters the target column while it is read. NO KEY keeps inserts that reference the project free.
            $projectRow = $this->lockActiveProject($project, __('This project is archived and its tasks cannot be moved.'));

            // The group goes before the task: retention deletes groups and then nulls their tasks (group, then task),
            // and ingestion's upsert holds only the group (project and source just FOR KEY SHARE, which this NO KEY
            // project lock lets through), so neither can close a cycle with this transaction.
            $group = $projectRow->tasks_resolve_log_groups && $status === TaskStatus::Done && $task->log_group_id !== null
                ? LogGroup::query()
                    ->whereKey($task->log_group_id)
                    ->where('project_id', $project->id)
                    ->lock('for no key update')
                    ->first()
                : null;

            $task = Task::query()->whereKey($task->id)->lockForUpdate()->firstOrFail();
            $entersDone = $status === TaskStatus::Done && $task->status !== TaskStatus::Done;

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
                $position = $this->renumberColumn($column, $slot, $renumbered);
            }

            $task->status = $status;
            $task->position = $position;
            $task->save();

            if ($entersDone && $group?->status === LogGroupStatus::Open && $task->log_group_id === $group->id) {
                $group->status = LogGroupStatus::Resolved;
                $group->save();
                $postGroupNotice($group, LogGroupStatus::Open, $actor);
            }

            return $task;
        });

        $task->load(self::RELATIONS)->loadCount(self::counts())->setRelation('project', $project);
        TaskUpdated::dispatch($task);

        Task::query()->with(self::RELATIONS)->withCount(self::counts())->whereKey($renumbered)->get()->each(
            fn (Task $neighbor) => TaskUpdated::dispatch($neighbor->setRelation('project', $project))
        );

        return new TaskResource($task);
    }

    /**
     * Locks the project row and re-checks, now that archiving cannot interleave, that it is still active: the request
     * validated it before the transaction. NO KEY keeps inserts that reference the project free.
     */
    private function lockActiveProject(Project $project, string $archivedMessage): object
    {
        $row = DB::table('projects')
            ->where('id', $project->id)
            ->lock('for no key update')
            ->first(['archived_at', 'tasks_resolve_log_groups']);

        if ($row === null || $row->archived_at !== null) {
            throw ValidationException::withMessages(['project' => $archivedMessage]);
        }

        return $row;
    }

    /**
     * Re-checks the assignee's access after the request validated it. FOR SHARE on the organization row waits for the
     * FOR UPDATE that access and membership changes hold until commit, and blocks them until this commit, so nobody is
     * assigned while losing access. It is taken first, before projects and tasks, like those changes do (organization,
     * then project_user and tasks), so no lock cycle; assignments do not block each other or inserts that reference
     * the organization.
     */
    private function lockAssigneeAccess(Project $project, ?int $assigneeId): void
    {
        if ($assigneeId === null) {
            return;
        }

        DB::table('organizations')->where('id', $project->organization_id)->sharedLock()->first();

        $assignee = User::query()->find($assigneeId);

        if ($assignee === null || ! ProjectAccess::canView($assignee, $project)) {
            throw ValidationException::withMessages([
                'assignee_id' => StoreTaskRequest::assigneeWithoutAccessMessage(),
            ]);
        }
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
     * @param  list<int>  $renumbered  receives the ids whose position changed, so other clients get them in live
     */
    private function renumberColumn(Collection $column, int $slot, array &$renumbered): float
    {
        foreach ($column as $index => $neighbor) {
            $position = (float) ($index < $slot ? $index + 1 : $index + 2);
            if ((float) $neighbor->position !== $position) {
                DB::table('tasks')->where('id', $neighbor->id)->update(['position' => $position]);
                $renumbered[] = $neighbor->id;
            }
        }

        return (float) ($slot + 1);
    }
}
