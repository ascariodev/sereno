<?php

namespace App\Http\Controllers\Api;

use App\Actions\CreateTask;
use App\Actions\DeleteTask;
use App\Actions\ListBoardTasks;
use App\Actions\MoveTask;
use App\Actions\UpdateTask;
use App\Events\TaskDeleted;
use App\Http\Controllers\Controller;
use App\Http\Requests\Task\DeleteTaskRequest;
use App\Http\Requests\Task\MoveTaskRequest;
use App\Http\Requests\Task\StoreTaskRequest;
use App\Http\Requests\Task\UpdateTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\ProjectAccess;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
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

    /** Done tasks listed when the board asks for a bounded Done column (`done_limit`). */
    public const MAX_DONE_LIMIT = 500;

    public function index(Request $request, Project $project, ListBoardTasks $listBoardTasks): AnonymousResourceCollection
    {
        Gate::authorize('view', $project);

        $doneLimit = $request->validate([
            'done_limit' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_DONE_LIMIT],
        ])['done_limit'] ?? null;

        $board = $listBoardTasks($project, [], $doneLimit);

        return TaskResource::collection($board['tasks'])->additional(['meta' => [
            'done_total' => $board['done_total'],
            'has_more_done' => $board['has_more_done'],
        ]]);
    }

    public function show(Project $project, Task $task): TaskResource
    {
        Gate::authorize('view', $project);
        throw_unless($task->project_id === $project->id, ModelNotFoundException::class);
        Gate::authorize('view', $task);

        $task->load(self::RELATIONS)->loadCount(self::counts())->setRelation('project', $project);

        return new TaskResource($task);
    }

    public function store(StoreTaskRequest $request, Project $project, CreateTask $createTask): JsonResponse
    {
        $task = $createTask(
            $project,
            $request->user(),
            $request->validated('title'),
            $request->validated('description'),
            $request->taskStatus(),
            $request->validated('assignee_id'),
            $request->validated('log_group_id'),
        );

        return (new TaskResource($task))->response()->setStatusCode(201);
    }

    public function update(UpdateTaskRequest $request, Project $project, Task $task, UpdateTask $updateTask): TaskResource
    {
        return new TaskResource($updateTask($project, $task, $request->user(), $request->validated()));
    }

    public function destroy(DeleteTaskRequest $request, Project $project, Task $task, DeleteTask $deleteTask): Response
    {
        $deleteTask($task);
        TaskDeleted::dispatch($task);

        return response()->noContent();
    }

    public function move(MoveTaskRequest $request, Project $project, Task $task, MoveTask $moveTask): TaskResource
    {
        $task = $moveTask(
            $task->setRelation('project', $project),
            $request->user(),
            $request->taskStatus(),
            $request->beforeId(),
            $request->afterId(),
        );

        return new TaskResource($task);
    }

    /**
     * Locks the project row and re-checks, now that archiving cannot interleave, that it is still active: the request
     * validated it before the transaction. NO KEY keeps inserts that reference the project free.
     */
    public static function lockActiveProject(Project $project, string $archivedMessage): object
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
    public static function lockAssigneeAccess(Project $project, ?int $assigneeId): void
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
}
