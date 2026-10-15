<?php

namespace App\Mcp\Tools;

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

        $base = fn () => Task::query()
            ->where('project_id', $project->id)
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($filters['assignee_id'] ?? null, fn ($query, $id) => $query->where('assignee_id', $id))
            ->when($filters['search'] ?? null, fn ($query, $text) => $query->where(
                'title',
                'ilike',
                '%'.addcslashes($text, '\\%_').'%',
            ));

        $cases = array_values(array_filter(TaskStatus::cases(), fn (TaskStatus $status) => $status !== TaskStatus::Done));
        $order = 'CASE status'.str_repeat(' WHEN ? THEN ?', count($cases)).' END';
        $bindings = [];
        foreach ($cases as $index => $status) {
            array_push($bindings, $status->value, $index);
        }

        $active = $base()
            ->where('status', '!=', TaskStatus::Done)
            ->with(TaskController::RELATIONS)
            ->withCount(TaskController::counts())
            ->orderByRaw($order, $bindings)
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        $doneQuery = $base()->where('status', TaskStatus::Done);
        $doneTotal = (clone $doneQuery)->count();
        $doneLimit = $filters['done_limit'] ?? null;

        $done = $doneQuery
            ->with(TaskController::RELATIONS)
            ->withCount(TaskController::counts())
            ->orderByDesc('position')
            ->orderByDesc('id')
            ->when($doneLimit !== null, fn ($query) => $query->limit($doneLimit))
            ->get()
            ->reverse()
            ->values();

        $tasks = $active->concat($done)->values();
        $tasks->each(fn (Task $task) => $task->setRelation('project', $project));

        return $this->structured([
            'data' => TaskResource::collection($tasks)->resolve(),
            'meta' => [
                'done_total' => $doneTotal,
                'has_more_done' => $done->count() < $doneTotal,
            ],
        ]);
    }
}
