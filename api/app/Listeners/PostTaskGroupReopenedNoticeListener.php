<?php

namespace App\Listeners;

use App\Actions\PostTaskGroupReopenedNotice;
use App\Events\LogGroupReopened;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * One try: the insert is not idempotent, so a retry after a late failure would duplicate the notice (L-07).
 * The setting and the task state are read here, in the worker, not when the event is dispatched (L-42).
 */
class PostTaskGroupReopenedNoticeListener implements ShouldQueue
{
    public int $tries = 1;

    public function handle(LogGroupReopened $event): void
    {
        app(PostTaskGroupReopenedNotice::class)($event->organizationId, $event->projectId, $event->logGroupId);
    }
}
