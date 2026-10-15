<?php

namespace App\Actions;

use App\Enums\TaskStatus;
use App\Events\TaskCreated;
use App\Http\Controllers\Api\TaskController;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CreateTask
{
    public function __construct(private readonly NotifyTaskAssignee $notifyAssignee) {}

    public function __invoke(
        Project $project,
        User $actor,
        string $title,
        ?string $description,
        TaskStatus $status,
        ?int $assigneeId,
        ?int $logGroupId,
    ): Task {
        try {
            $task = DB::transaction(function () use ($project, $actor, $title, $description, $status, $assigneeId, $logGroupId) {
                TaskController::lockAssigneeAccess($project, $assigneeId);
                TaskController::lockActiveProject($project, __('This project is archived and cannot have new tasks.'));

                // Locks the project row until commit, so numbers and positions of the project are serialized.
                $number = DB::selectOne(
                    'UPDATE projects SET last_task_number = last_task_number + 1 WHERE id = ? RETURNING last_task_number',
                    [$project->id],
                )->last_task_number;

                $last = Task::query()
                    ->where('project_id', $project->id)
                    ->where('status', $status)
                    ->max('position');

                $task = new Task([
                    'title' => $title,
                    'description' => $description,
                    'status' => $status,
                    'position' => $last === null ? 1.0 : (float) $last + 1.0,
                ]);
                $task->project_id = $project->id;
                $task->number = (int) $number;
                $task->assignee_id = $assigneeId;
                $task->log_group_id = $logGroupId;
                $task->created_by = $actor->id;
                $task->save();

                if ($task->log_group_id !== null) {
                    $task->setRelation('project', $project);
                    $this->postTaskCreatedNotice($project, $task);
                }

                return $task;
            });
        } catch (UniqueConstraintViolationException $exception) {
            if (! str_contains($exception->getMessage(), 'tasks_log_group_id_unique')) {
                throw $exception;
            }

            // Another request linked the same log group between validation and insert.
            throw ValidationException::withMessages([
                'log_group_id' => __('The log group already has a task.'),
            ]);
        }

        $task->load(TaskController::RELATIONS)->loadCount(TaskController::counts())->setRelation('project', $project);
        TaskCreated::dispatch($task);
        ($this->notifyAssignee)($task, $actor);

        return $task;
    }

    private function postTaskCreatedNotice(Project $project, Task $task): void
    {
        $channel = Channel::query()
            ->where('project_id', $project->id)
            ->whereNull('archived_at')
            ->first();

        if ($channel === null) {
            return;
        }

        $message = new Message([
            'kind' => Message::KIND_SYSTEM,
            'payload' => [
                'type' => 'task.created_from_group',
                'log_group_id' => $task->log_group_id,
                'task_id' => $task->id,
                'task_key' => $task->key(),
                'task_status' => $task->status->value,
            ],
        ]);
        $message->forceFill([
            'organization_id' => $task->organization_id,
            'channel_id' => $channel->id,
            'user_id' => $task->created_by,
            'log_group_id' => $task->log_group_id,
        ])->save();
    }
}
