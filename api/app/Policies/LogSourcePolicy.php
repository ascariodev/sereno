<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\LogSource;
use App\Models\User;
use App\Policies\Concerns\ChecksActiveOrganization;

/**
 * Roles are read from the active permission team, which ResolveOrganization sets.
 * Every check on an instance also requires it to belong to the active organization.
 */
class LogSourcePolicy
{
    use ChecksActiveOrganization;

    public function viewAny(User $user): bool
    {
        return $this->hasActiveOrganization() && $user->hasAnyRole(array_column(Role::cases(), 'value'));
    }

    public function view(User $user, LogSource $source): bool
    {
        return $this->belongsToActiveOrganization($source) && $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->canManage($user);
    }

    public function revoke(User $user, LogSource $source): bool
    {
        return $this->belongsToActiveOrganization($source) && $this->canManage($user);
    }

    public function rotateKey(User $user, LogSource $source): bool
    {
        return $this->belongsToActiveOrganization($source) && $this->canManage($user);
    }
}
