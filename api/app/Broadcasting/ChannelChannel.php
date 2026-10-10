<?php

namespace App\Broadcasting;

use App\Models\Channel;
use App\Models\Scopes\OrganizationScope;
use App\Models\User;
use App\Support\ProjectAccess;

/**
 * Authorized without X-Organization-Id: membership, channel ownership and project access are checked here.
 * A channel without a project is visible to the whole organization.
 */
class ChannelChannel
{
    public function join(User $user, string $organization, string $channel): bool
    {
        $organizationId = self::positiveId($organization);
        $channelId = self::positiveId($channel);

        if ($organizationId === null || $channelId === null) {
            return false;
        }

        if (! $user->organizations()->whereKey($organizationId)->exists()) {
            return false;
        }

        $found = Channel::withoutGlobalScope(OrganizationScope::class)
            ->whereKey($channelId)
            ->where('organization_id', $organizationId)
            ->first(['id', 'project_id']);

        if ($found === null) {
            return false;
        }

        return $found->project_id === null
            || ProjectAccess::canViewId($user, $organizationId, $found->project_id);
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
