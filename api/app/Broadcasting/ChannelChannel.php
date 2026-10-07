<?php

namespace App\Broadcasting;

use App\Models\Channel;
use App\Models\Scopes\OrganizationScope;
use App\Models\User;

/**
 * Authorized without X-Organization-Id: membership and channel ownership are checked here.
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

        return $user->organizations()->whereKey($organizationId)->exists()
            && Channel::withoutGlobalScope(OrganizationScope::class)
                ->whereKey($channelId)
                ->where('organization_id', $organizationId)
                ->exists();
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
