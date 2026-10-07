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
        if (! ctype_digit($organization) || ! ctype_digit($channel)) {
            return false;
        }

        return $user->organizations()->whereKey($organization)->exists()
            && Channel::withoutGlobalScope(OrganizationScope::class)
                ->whereKey($channel)
                ->where('organization_id', $organization)
                ->exists();
    }
}
