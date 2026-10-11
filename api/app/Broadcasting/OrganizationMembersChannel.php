<?php

namespace App\Broadcasting;

use App\Broadcasting\Concerns\ParsesPositiveId;
use App\Models\User;
use App\Support\ProjectAccess;

/**
 * Authorized without X-Organization-Id: only owners and admins of the organization follow its member list.
 */
class OrganizationMembersChannel
{
    use ParsesPositiveId;

    public function join(User $user, string $organization): bool
    {
        $organizationId = self::positiveId($organization);

        return $organizationId !== null
            && $user->organizations()->whereKey($organizationId)->exists()
            && ProjectAccess::seesAll($user, $organizationId);
    }
}
