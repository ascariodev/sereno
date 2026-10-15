<?php

namespace App\Mcp\Tools;

use App\Actions\MoveTask;
use App\Enums\TaskStatus;
use App\Http\Requests\Task\MoveTaskRequest;
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

#[Description('Moves a task to a column of the board as the token owner. Without before_id and after_id the task goes to the top of the column. Moving a task to done resolves its log group if the project is set up to do so.')]
#[Name('move-task')]
class MoveTaskTool extends Tool
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
            'status' => $schema->string()
                ->enum(array_map(fn (TaskStatus $status) => $status->value, TaskStatus::cases()))
                ->description('Column of the board to move the task to.')
                ->required(),
            'before_id' => $schema->integer()
                ->description('Id of the task that ends up right below the moved one. It must be in the target column.'),
            'after_id' => $schema->integer()
                ->description('Id of the task that ends up right above the moved one. It must be in the target column.'),
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

        $data = Validator::make($request->toArray(), $this->rules($task))
            ->after(function ($validator) use ($project) {
                if ($project->isArchived()) {
                    $validator->errors()->add('project', __('This project is archived and its tasks cannot be moved.'));
                }
            })
            ->validate();

        $status = TaskStatus::from($data['status']);
        $beforeId = $data['before_id'] ?? null;
        $afterId = $data['after_id'] ?? null;

        if ($beforeId === null && $afterId === null) {
            $beforeId = Task::query()
                ->where('project_id', $project->id)
                ->where('status', $status)
                ->whereKeyNot($task->id)
                ->orderBy('position')
                ->orderBy('id')
                ->value('id');
        }

        $moved = app(MoveTask::class)($task->setRelation('project', $project), $user, $status, $beforeId, $afterId);

        return $this->structured(['data' => (new TaskResource($moved))->resolve()]);
    }

    /**
     * @return array<string, mixed>
     */
    private function rules(Task $task): array
    {
        $routeWithTask = new class($task)
        {
            public function __construct(private readonly Task $task) {}

            public function parameter(string $name): Task
            {
                return $this->task;
            }
        };

        $formRequest = new MoveTaskRequest;
        $formRequest->setRouteResolver(fn () => $routeWithTask);

        return $formRequest->rules();
    }
}
