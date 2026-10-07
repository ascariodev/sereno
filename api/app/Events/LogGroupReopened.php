<?php

namespace App\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A resolved log group went back to open because a new event arrived.
 * Holds plain values instead of the model: queued listeners run without an active
 * organization, so OrganizationScope would fail to restore it.
 */
class LogGroupReopened implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly int $organizationId,
        public readonly int $projectId,
        public readonly int $logGroupId,
        public readonly string $level,
        public readonly string $title,
        public readonly int $eventsCount,
    ) {}
}
