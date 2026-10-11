<?php

namespace App\Broadcasting;

use App\Broadcasting\Concerns\ParsesPositiveId;
use App\Models\Project;
use App\Models\Scopes\OrganizationScope;
use App\Models\User;
use App\Support\ProjectAccess;

/**
 * Authorized without X-Organization-Id: membership, project ownership and project access are checked here.
 */
class ProjectChannel
{
    use ParsesPositiveId;

    public function join(User $user, string $organization, string $project): bool
    {
        $organizationId = self::positiveId($organization);
        $projectId = self::positiveId($project);

        if ($organizationId === null || $projectId === null) {
            return false;
        }

        return $user->organizations()->whereKey($organizationId)->exists()
            && Project::withoutGlobalScope(OrganizationScope::class)
                ->whereKey($projectId)
                ->where('organization_id', $organizationId)
                ->exists()
            && ProjectAccess::canViewId($user, $organizationId, $projectId);
    }
}
