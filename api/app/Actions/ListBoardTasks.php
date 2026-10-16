<?php

namespace App\Actions;

use App\Enums\TaskStatus;
use App\Http\Controllers\Api\TaskController;
use App\Models\Project;
use App\Models\Task;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class ListBoardTasks
{
    /**
     * Board order: active tasks by column and position, then the done column (optionally only its last `$doneLimit`).
     *
     * @param  array{status?: ?string, assignee_id?: ?int, search?: ?string}  $filters
     * @return array{tasks: Collection<int, Task>, done_total: int, has_more_done: bool}
     */
    public function __invoke(Project $project, array $filters = [], ?int $doneLimit = null): array
    {
        $base = fn () => Task::query()
            ->where('project_id', $project->id)
            ->when($filters['status'] ?? null, fn (Builder $query, $status) => $query->where('status', $status))
            ->when($filters['assignee_id'] ?? null, fn (Builder $query, $id) => $query->where('assignee_id', $id))
            ->when($filters['search'] ?? null, fn (Builder $query, $text) => $query->where(
                'title',
                'ilike',
                '%'.addcslashes($text, '\%_').'%',
            ));

        $cases = array_values(array_filter(TaskStatus::cases(), fn (TaskStatus $status) => $status !== TaskStatus::Done));
        $order = 'CASE status'.str_repeat(' WHEN ? THEN ?', count($cases)).' END';
        $bindings = [];
        foreach ($cases as $index => $status) {
            array_push($bindings, $status->value, $index);
        }

        $active = $base()
            ->where('status', '!=', TaskStatus::Done)
            ->with(Task::RELATIONS)
            ->withCount(TaskController::counts())
            ->orderByRaw($order, $bindings)
            ->orderBy('position')
            ->orderBy('id')
            ->get();

        $doneQuery = $base()->where('status', TaskStatus::Done);
        $doneTotal = (clone $doneQuery)->count();

        // New and moved tasks land at the end of the column, so the last ones by position are the most recent. The
        // cut is contiguous, which keeps drag & drop neighbors adjacent; it is returned in column order.
        $done = $doneQuery
            ->with(Task::RELATIONS)
            ->withCount(TaskController::counts())
            ->orderByDesc('position')
            ->orderByDesc('id')
            ->when($doneLimit !== null, fn (Builder $query) => $query->limit($doneLimit))
            ->get()
            ->reverse()
            ->values();

        $tasks = $active->concat($done)->values();

        // key() reads the project: share the one already loaded instead of one query per task.
        $tasks->each(fn (Task $task) => $task->setRelation('project', $project));

        return [
            'tasks' => $tasks,
            'done_total' => $doneTotal,
            'has_more_done' => $done->count() < $doneTotal,
        ];
    }
}
