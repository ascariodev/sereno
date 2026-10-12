<?php

namespace App\Actions;

use App\Enums\LogGroupStatus;
use App\Enums\TaskStatus;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\Project;
use App\Models\Task;

/** Runs without an active organization (queue): explicit tenant filters. Only notifies. */
class PostTaskGroupReopenedNotice
{
    public function __invoke(int $organizationId, int $projectId, int $logGroupId): void
    {
        $project = Project::withoutGlobalScopes()
            ->whereKey($projectId)
            ->where('organization_id', $organizationId)
            ->first();

        if ($project === null || ! $project->tasks_resolve_log_groups) {
            return;
        }

        $groupIsOpen = LogGroup::withoutGlobalScopes()
            ->whereKey($logGroupId)
            ->where('organization_id', $organizationId)
            ->where('project_id', $projectId)
            ->where('status', LogGroupStatus::Open)
            ->exists();

        if (! $groupIsOpen) {
            return;
        }

        $task = Task::withoutGlobalScopes()
            ->where('project_id', $projectId)
            ->where('log_group_id', $logGroupId)
            ->where('status', TaskStatus::Done)
            ->first();

        if ($task === null) {
            return;
        }

        $channel = Channel::withoutGlobalScopes()
            ->where('organization_id', $organizationId)
            ->where('project_id', $projectId)
            ->whereNull('archived_at')
            ->first();

        if ($channel === null) {
            return;
        }

        $message = new Message([
            'kind' => Message::KIND_SYSTEM,
            'payload' => [
                'type' => 'task.group_reopened',
                'log_group_id' => $logGroupId,
                'task_id' => $task->id,
                'task_key' => $project->key.'-'.$task->number,
            ],
        ]);
        $message->forceFill([
            'organization_id' => $organizationId,
            'channel_id' => $channel->id,
            'log_group_id' => $logGroupId,
        ])->save();
    }
}
