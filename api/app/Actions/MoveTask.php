<?php

namespace App\Actions;

use App\Enums\LogGroupStatus;
use App\Enums\TaskStatus;
use App\Events\TaskUpdated;
use App\Models\LogGroup;
use App\Models\Task;
use App\Models\User;
use App\Support\TaskLocks;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * `after_id` is the task that ends up right above the moved one and `before_id` the one right below it; without
 * either, the task goes to the end of the column.
 */
class MoveTask
{
    /** Below this gap between neighbors the column is renumbered instead of halving it again. */
    private const MIN_POSITION_GAP = 1e-9;

    public function __construct(private readonly PostLogGroupStatusNotice $postGroupNotice) {}

    public function __invoke(Task $task, User $actor, TaskStatus $status, ?int $beforeId = null, ?int $afterId = null): Task
    {
        $project = $task->project;

        $renumbered = [];

        $task = DB::transaction(function () use ($project, $task, $status, $beforeId, $afterId, $actor, &$renumbered) {
            // Same lock as CreateTask takes with its UPDATE: creations and moves of the project are serialized, so no
            // task enters the target column while it is read. NO KEY keeps inserts that reference the project free.
            $projectRow = TaskLocks::lockActiveProject($project, __('This project is archived and its tasks cannot be moved.'));

            // The group goes before the task: retention deletes groups and then nulls their tasks (group, then task),
            // and ingestion's upsert holds only the group (project and source just FOR KEY SHARE, which this NO KEY
            // project lock lets through), so neither can close a cycle with this transaction.
            $group = $projectRow->tasks_resolve_log_groups && $status === TaskStatus::Done && $task->log_group_id !== null
                ? LogGroup::query()
                    ->whereKey($task->log_group_id)
                    ->where('project_id', $project->id)
                    ->lock('for no key update')
                    ->first()
                : null;

            $task = Task::query()->whereKey($task->id)->lockForUpdate()->firstOrFail();
            $entersDone = $status === TaskStatus::Done && $task->status !== TaskStatus::Done;

            $column = Task::query()
                ->where('project_id', $project->id)
                ->where('status', $status)
                ->whereKeyNot($task->id)
                ->orderBy('position')
                ->orderBy('id')
                ->lockForUpdate()
                ->get(['id', 'position'])
                ->values();

            $slot = $this->moveSlot($column, $beforeId, $afterId);

            $previous = $column[$slot - 1] ?? null;
            $next = $column[$slot] ?? null;
            $position = match (true) {
                $previous === null && $next === null => 1.0,
                $previous === null => $next->position - 1.0,
                $next === null => $previous->position + 1.0,
                default => ($previous->position + $next->position) / 2,
            };

            if ($previous !== null && $next !== null && (
                $next->position - $previous->position <= self::MIN_POSITION_GAP
                || $position <= $previous->position
                || $position >= $next->position
            )) {
                $position = $this->renumberColumn($column, $slot, $renumbered);
            }

            $task->status = $status;
            $task->position = $position;
            $task->save();

            if ($entersDone && $group?->status === LogGroupStatus::Open && $task->log_group_id === $group->id) {
                $group->status = LogGroupStatus::Resolved;
                $group->save();
                ($this->postGroupNotice)($group, LogGroupStatus::Open, $actor);
            }

            return $task;
        });

        $task->load(Task::RELATIONS)->loadCount(Task::counts())->setRelation('project', $project);
        TaskUpdated::dispatch($task);

        Task::query()->with(Task::RELATIONS)->withCount(Task::counts())->whereKey($renumbered)->get()->each(
            fn (Task $neighbor) => TaskUpdated::dispatch($neighbor->setRelation('project', $project))
        );

        return $task;
    }

    /**
     * Index in the target column (without the moved task) where the task goes; validates that the neighbors are in
     * that column and, when both come, that nothing sits between them.
     *
     * @param  Collection<int, Task>  $column
     */
    private function moveSlot(Collection $column, ?int $beforeId, ?int $afterId): int
    {
        $index = fn (int $id) => $column->search(fn (Task $neighbor) => $neighbor->id === $id);

        $afterIndex = $afterId === null ? null : $index($afterId);
        $beforeIndex = $beforeId === null ? null : $index($beforeId);

        foreach (['after_id' => $afterIndex, 'before_id' => $beforeIndex] as $field => $found) {
            if ($found === false) {
                throw ValidationException::withMessages([
                    $field => __('The neighbor task is not in the target column of this project.'),
                ]);
            }
        }

        if ($afterIndex !== null && $beforeIndex !== null && $beforeIndex !== $afterIndex + 1) {
            throw ValidationException::withMessages([
                'before_id' => __('The neighbor tasks are not next to each other.'),
            ]);
        }

        return match (true) {
            $afterIndex !== null => $afterIndex + 1,
            $beforeIndex !== null => $beforeIndex,
            default => $column->count(),
        };
    }

    /**
     * Spreads the column over 1, 2, 3... leaving the moved task's slot free, and returns the position of that slot.
     *
     * @param  Collection<int, Task>  $column
     * @param  list<int>  $renumbered  receives the ids whose position changed, so other clients get them in live
     */
    private function renumberColumn(Collection $column, int $slot, array &$renumbered): float
    {
        foreach ($column as $index => $neighbor) {
            $position = (float) ($index < $slot ? $index + 1 : $index + 2);
            if ((float) $neighbor->position !== $position) {
                DB::table('tasks')->where('id', $neighbor->id)->update(['position' => $position]);
                $renumbered[] = $neighbor->id;
            }
        }

        return (float) ($slot + 1);
    }
}
