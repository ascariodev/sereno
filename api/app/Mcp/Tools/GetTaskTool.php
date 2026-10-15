<?php

namespace App\Mcp\Tools;

use App\Http\Controllers\Api\TaskCommentController;
use App\Http\Controllers\Api\TaskController;
use App\Http\Requests\TaskComment\ListTaskCommentsRequest;
use App\Http\Resources\TaskCommentResource;
use App\Http\Resources\TaskResource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Pagination\Cursor;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('Returns one task of a project with its details and a page of its comments, newest first. When comments.next_cursor is not null, pass it as cursor to get the older comments.')]
#[Name('get-task')]
#[IsReadOnly]
#[IsIdempotent]
class GetTaskTool extends Tool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->integer()
                ->description('Id of the project, as returned by list-projects.')
                ->required(),
            'task_id' => $schema->integer()
                ->description('Id of the task, as returned by list-tasks.')
                ->required(),
            'cursor' => $schema->string()
                ->description('Value of comments.next_cursor from the previous call, to read older comments.'),
            'per_page' => $schema->integer()
                ->description('Comments per page. Defaults to '.ListTaskCommentsRequest::DEFAULT_PER_PAGE.'; at most '.ListTaskCommentsRequest::MAX_PER_PAGE.'.'),
        ];
    }

    protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory
    {
        $ids = $request->validate([
            'project_id' => ['required', 'integer', 'min:1'],
            'task_id' => ['required', 'integer', 'min:1'],
        ]);

        $project = Project::query()->findOrFail($ids['project_id']);
        $this->authorize($user, 'view', $project);

        $task = Task::query()->findOrFail($ids['task_id']);
        throw_unless($task->project_id === $project->id, ModelNotFoundException::class);
        $this->authorize($user, 'view', $task);

        $arguments = $request->validate((new ListTaskCommentsRequest)->rules());

        $task->load(TaskController::RELATIONS)->loadCount(TaskController::counts())->setRelation('project', $project);

        $page = $task->comments()
            ->with(TaskCommentController::RELATIONS)
            ->orderByDesc('id')
            ->cursorPaginate(
                $arguments['per_page'] ?? ListTaskCommentsRequest::DEFAULT_PER_PAGE,
                cursor: isset($arguments['cursor']) ? Cursor::fromEncoded($arguments['cursor']) : null,
            );

        return $this->structured([
            'data' => (new TaskResource($task))->resolve(),
            'comments' => [
                'data' => TaskCommentResource::collection($page->getCollection())->resolve(),
                'next_cursor' => $page->nextCursor()?->encode(),
            ],
        ]);
    }
}
