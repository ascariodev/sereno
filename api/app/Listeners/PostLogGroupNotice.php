<?php

namespace App\Listeners;

use App\Events\LogGroupOpened;
use App\Events\LogGroupReopened;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Runs in the worker without an active organization, so it queries with explicit tenant
 * filters instead of OrganizationScope. One try: the insert is not idempotent (a group can be
 * reopened many times), so a retry after a late failure would duplicate the notice (L-07).
 */
class PostLogGroupNotice implements ShouldQueue
{
    public int $tries = 1;

    public function handle(LogGroupOpened|LogGroupReopened $event): void
    {
        $channel = Channel::withoutGlobalScopes()
            ->where('organization_id', $event->organizationId)
            ->where('project_id', $event->projectId)
            ->whereNull('archived_at')
            ->first();

        $groupExists = LogGroup::withoutGlobalScopes()
            ->whereKey($event->logGroupId)
            ->where('organization_id', $event->organizationId)
            ->where('project_id', $event->projectId)
            ->exists();

        if ($channel === null || ! $groupExists) {
            return;
        }

        $message = new Message([
            'kind' => Message::KIND_SYSTEM,
            'payload' => [
                'type' => $event instanceof LogGroupOpened ? 'log.group_opened' : 'log.group_reopened',
                'log_group_id' => $event->logGroupId,
                'level' => $event->level,
                'title' => $event->title,
                'events_count' => $event->eventsCount,
            ],
        ]);
        $message->forceFill([
            'organization_id' => $event->organizationId,
            'channel_id' => $channel->id,
            'log_group_id' => $event->logGroupId,
        ])->save();
    }
}
