<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Invitation;
use App\Models\User;

/**
 * Roles are read from the active permission team, which ResolveOrganization sets.
 * An admin may invite admins and members but never owners.
 */
class InvitationPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasAnyRole([Role::Owner->value, Role::Admin->value]);
    }

    public function create(User $user, ?Role $role): bool
    {
        if ($user->hasRole(Role::Owner->value)) {
            return true;
        }

        return $user->hasRole(Role::Admin->value) && $role !== Role::Owner;
    }

    public function delete(User $user, Invitation $invitation): bool
    {
        $role = Role::tryFrom($invitation->role);

        return $role !== null && $this->create($user, $role);
    }
}
