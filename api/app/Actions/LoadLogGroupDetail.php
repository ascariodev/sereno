<?php

namespace App\Actions;

use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\Project;

class LoadLogGroupDetail
{
    public const EVENTS_LIMIT = 50;

    /** Loads the latest events inside the retention window (newest first) and the linked task. */
    public function __invoke(Project $project, LogGroup $group): LogGroup
    {
        $group->setRelation('events', LogEvent::query()
            ->with('source:id,name')
            ->where('log_group_id', $group->id)
            ->where('received_at', '>=', now()->subDays(config('workspace.log.retention_days')))
            ->orderByDesc('received_at')
            ->orderByDesc('id')
            ->limit(self::EVENTS_LIMIT)
            ->get());

        $group->load('task')->task?->setRelation('project', $project);

        return $group;
    }
}
