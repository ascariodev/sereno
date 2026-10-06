<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\LogGroup;
use App\Models\User;
use App\Support\CurrentOrganization;

/**
 * Roles are read from the active permission team, which ResolveOrganization sets.
 * Every check on an instance also requires it to belong to the active organization.
 */
class LogGroupPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->activeOrganizationId() !== null
            && $user->hasAnyRole(array_column(Role::cases(), 'value'));
    }

    public function view(User $user, LogGroup $group): bool
    {
        return $group->organization_id === $this->activeOrganizationId() && $this->viewAny($user);
    }

    private function activeOrganizationId(): ?int
    {
        return app(CurrentOrganization::class)->id();
    }
}
