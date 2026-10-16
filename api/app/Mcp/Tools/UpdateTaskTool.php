<?php

namespace App\Mcp\Tools;

use App\Actions\UpdateTask;
use App\Http\Requests\Task\StoreTaskRequest;
use App\Http\Requests\Task\UpdateTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Validator;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;

#[Description('Updates the title, description and/or assignee of a task as the token owner. Only the fields you pass change; assignee_id null unassigns. A new assignee is notified. Use list-project-members to choose the assignee. To change the column use move-task.')]
#[Name('update-task')]
#[IsIdempotent]
class UpdateTaskTool extends Tool
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
            'title' => $schema->string()
                ->description('New title, at most '.Task::TITLE_MAX_LENGTH.' characters.'),
            'description' => $schema->string()
                ->description('New description, at most '.Task::DESCRIPTION_MAX_LENGTH.' characters. An empty value clears it.'),
            'assignee_id' => $schema->integer()
                ->description('Id of the user to assign, as returned by list-project-members. Null unassigns.'),
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
        $this->authorize($user, 'update', $task);

        $input = $request->toArray();
        $data = Validator::make($input, (new UpdateTaskRequest)->rules())
            ->after(function ($validator) use ($project, $task, $input) {
                if ($project->isArchived()) {
                    $validator->errors()->add('project', __('This project is archived and its tasks cannot be edited.'));
                }

                $assigneeId = $input['assignee_id'] ?? null;
                if ($assigneeId === null || (int) $assigneeId !== $task->assignee_id) {
                    StoreTaskRequest::validateAssigneeAccess($validator, $project, $assigneeId);
                }
            })
            ->validate();

        $updated = app(UpdateTask::class)($project, $task, $user, $data);

        return $this->structured(['data' => (new TaskResource($updated))->resolve()]);
    }
}
