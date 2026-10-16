<?php

namespace App\Mcp\Tools;

use App\Actions\CreateTask;
use App\Enums\ContentSource;
use App\Enums\TaskStatus;
use App\Http\Requests\Task\StoreTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\Validator;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;

#[Description('Creates a task in a project as the token owner. The assignee, if any, is notified. Pass log_group_id to create the task from a log alert.')]
#[Name('create-task')]
class CreateTaskTool extends Tool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->integer()
                ->description('Id of the project, as returned by list-projects.')
                ->required(),
            'title' => $schema->string()
                ->description('Title of the task, at most '.Task::TITLE_MAX_LENGTH.' characters.')
                ->required(),
            'description' => $schema->string()
                ->description('Description of the task, at most '.Task::DESCRIPTION_MAX_LENGTH.' characters.'),
            'status' => $schema->string()
                ->enum(array_map(fn (TaskStatus $status) => $status->value, TaskStatus::cases()))
                ->description('Column of the board. Defaults to todo.'),
            'assignee_id' => $schema->integer()
                ->description('Id of the user to assign. Must be a member of the organization with access to the project.'),
            'log_group_id' => $schema->integer()
                ->description('Id of the log group (see list-log-groups) the task is created from. A log group can have only one task.'),
        ];
    }

    protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory
    {
        $projectId = $request->validate(['project_id' => ['required', 'integer', 'min:1']])['project_id'];

        $project = Project::query()->findOrFail($projectId);
        $this->authorize($user, 'create', Task::class);
        $this->authorize($user, 'view', $project);

        $input = $request->toArray();
        $data = Validator::make($input, (new StoreTaskRequest)->rules())
            ->after(fn ($validator) => StoreTaskRequest::validateBusinessRules(
                $validator, $project, $input['assignee_id'] ?? null, $input['log_group_id'] ?? null,
            ))
            ->validate();

        $task = app(CreateTask::class)(
            $project,
            $user,
            $data['title'],
            $data['description'] ?? null,
            TaskStatus::tryFrom($data['status'] ?? '') ?? TaskStatus::Todo,
            $data['assignee_id'] ?? null,
            $data['log_group_id'] ?? null,
            ContentSource::Mcp,
        );

        return $this->structured(['data' => (new TaskResource($task))->resolve()]);
    }
}
