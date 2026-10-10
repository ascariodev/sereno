<?php

namespace App\Broadcasting;

use App\Models\Project;
use App\Models\Scopes\OrganizationScope;
use App\Models\User;
use App\Support\ProjectAccess;

/**
 * Authorized without X-Organization-Id: membership, project ownership and project access are checked here.
 */
class ProjectChannel
{
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

    private static function positiveId(string $value): ?int
    {
        if (! ctype_digit($value)) {
            return null;
        }

        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $id === false ? null : $id;
    }
}
