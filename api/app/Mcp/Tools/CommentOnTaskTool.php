<?php

namespace App\Mcp\Tools;

use App\Actions\CreateTaskComment;
use App\Enums\ContentSource;
use App\Http\Requests\TaskComment\StoreTaskCommentRequest;
use App\Http\Resources\TaskCommentResource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;

#[Description('Adds a comment to a task as the token owner. Mention a project member with <@user_id>; mentioned people are notified. Attachments are not supported.')]
#[Name('comment-on-task')]
class CommentOnTaskTool extends Tool
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
            'body' => $schema->string()
                ->description('Text of the comment, at most '.TaskComment::BODY_MAX_LENGTH.' characters. Use <@user_id> to mention a project member.')
                ->required(),
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
        $this->authorize($user, 'create', [TaskComment::class, $task]);

        $arguments = $request->validate(['body' => (new StoreTaskCommentRequest)->rules()['body']]);

        $comment = app(CreateTaskComment::class)($task, $user, $arguments['body'], source: ContentSource::Mcp);

        return $this->structured(['data' => (new TaskCommentResource($comment))->resolve()]);
    }
}
