<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\User;

/**
 * Registered for User in AppServiceProvider: the target of every member rule is a user.
 * Roles are read from the active permission team, which ResolveOrganization sets.
 */
class MemberPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasAnyRole(array_column(Role::cases(), 'value'));
    }

    public function updateRole(User $actor, User $target, ?Role $role): bool
    {
        if ($actor->hasRole(Role::Owner->value)) {
            return true;
        }

        return $actor->hasRole(Role::Admin->value)
            && $role !== Role::Owner
            && ! $target->hasRole(Role::Owner->value);
    }
}
