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
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class TaskController extends Controller
{
    public function index(Request $request, Project $project, ListBoardTasks $listBoardTasks): AnonymousResourceCollection
    {
        Gate::authorize('view', $project);

        $doneLimit = $request->validate([
            'done_limit' => ['sometimes', 'integer', 'min:1', 'max:'.ListBoardTasks::MAX_DONE_LIMIT],
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

        $task->load(Task::RELATIONS)->loadCount(Task::counts())->setRelation('project', $project);

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
}
