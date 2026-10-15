<?php

namespace App\Actions;

use App\Events\TaskAssigned;
use App\Models\Task;
use App\Models\User;
use App\Notifications\TaskAssignedNotification;
use App\Support\ProjectAccess;

class NotifyTaskAssignee
{
    public function __invoke(Task $task, User $actor): void
    {
        if ($task->assignee_id === null || $task->assignee_id === $actor->id) {
            return;
        }

        TaskAssigned::dispatch($task->assignee_id, $task->organization_id, $task->project_id, $task->id);

        $assignee = User::query()->find($task->assignee_id);

        if ($assignee !== null && ProjectAccess::canViewId($assignee, $task->organization_id, $task->project_id)) {
            $assignee->notify(TaskAssignedNotification::for($task, $actor));
        }
    }
}
