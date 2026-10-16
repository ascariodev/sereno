<?php

namespace App\Actions;

use App\Events\TaskUpdated;
use App\Http\Controllers\Api\TaskController;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class UpdateTask
{
    public function __construct(private readonly NotifyTaskAssignee $notifyAssignee) {}

    /**
     * @param  array<string, mixed>  $data  Validated title, description and assignee_id; absent keys stay as they are.
     */
    public function __invoke(Project $project, Task $task, User $actor, array $data): Task
    {
        $newAssigneeId = array_key_exists('assignee_id', $data) && $data['assignee_id'] !== null
            && (int) $data['assignee_id'] !== $task->assignee_id ? (int) $data['assignee_id'] : null;

        DB::transaction(function () use ($project, $task, $data, $newAssigneeId) {
            TaskController::lockAssigneeAccess($project, $newAssigneeId);
            TaskController::lockActiveProject($project, __('This project is archived and its tasks cannot be edited.'));
            $task->fill($data)->save();
        });

        $task->load(TaskController::RELATIONS)->loadCount(TaskController::counts())->setRelation('project', $project);
        TaskUpdated::dispatch($task);
        if ($newAssigneeId !== null) {
            ($this->notifyAssignee)($task, $actor);
        }

        return $task;
    }
}
