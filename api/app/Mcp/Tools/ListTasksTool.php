<?php

namespace App\Mcp\Tools;

use App\Actions\ListBoardTasks;
use App\Enums\TaskStatus;
use App\Http\Controllers\Api\TaskController;
use App\Http\Resources\TaskResource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Validation\Rule;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('Lists the tasks of a project the current user can see, ordered by board column (todo, in_progress, in_review, done) and position. Optional filters: status, assignee_id and search (text contained in the title). done_limit keeps only the most recent done tasks; meta.done_total and meta.has_more_done tell whether done tasks were left out.')]
#[Name('list-tasks')]
#[IsReadOnly]
#[IsIdempotent]
class ListTasksTool extends Tool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->integer()
                ->description('Id of the project, as returned by list-projects.')
                ->required(),
            'status' => $schema->string()
                ->enum(array_column(TaskStatus::cases(), 'value'))
                ->description('Only tasks in this status.'),
            'assignee_id' => $schema->integer()
                ->description('Only tasks assigned to this user id.'),
            'search' => $schema->string()
                ->description('Only tasks whose title contains this text, ignoring case.'),
            'done_limit' => $schema->integer()
                ->description('Maximum number of done tasks to return (the most recent ones). Defaults to all of them; at most '.TaskController::MAX_DONE_LIMIT.'.'),
        ];
    }

    protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory
    {
        $projectId = $request->validate(['project_id' => ['required', 'integer', 'min:1']])['project_id'];

        $project = Project::query()->findOrFail($projectId);
        $this->authorize($user, 'view', $project);

        $filters = $request->validate([
            'status' => ['nullable', Rule::enum(TaskStatus::class)],
            'assignee_id' => ['nullable', 'integer', 'min:1'],
            'search' => ['nullable', 'string', 'max:'.Task::TITLE_MAX_LENGTH],
            'done_limit' => ['nullable', 'integer', 'min:1', 'max:'.TaskController::MAX_DONE_LIMIT],
        ]);

        $board = app(ListBoardTasks::class)($project, $filters, $filters['done_limit'] ?? null);

        return $this->structured([
            'data' => TaskResource::collection($board['tasks'])->resolve(),
            'meta' => [
                'done_total' => $board['done_total'],
                'has_more_done' => $board['has_more_done'],
            ],
        ]);
    }
}
