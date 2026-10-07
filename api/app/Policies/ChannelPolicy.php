<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Channel;
use App\Models\User;
use App\Support\CurrentOrganization;

/**
 * Roles are read from the active permission team, which ResolveOrganization sets.
 * Every check on an instance also requires it to belong to the active organization.
 */
class ChannelPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->activeOrganizationId() !== null
            && $user->hasAnyRole(array_column(Role::cases(), 'value'));
    }

    public function view(User $user, Channel $channel): bool
    {
        return $this->belongsToActiveOrganization($channel) && $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->canManage($user);
    }

    public function update(User $user, Channel $channel): bool
    {
        return $this->belongsToActiveOrganization($channel) && $this->canManage($user);
    }

    public function archive(User $user, Channel $channel): bool
    {
        return $this->update($user, $channel);
    }

    private function canManage(User $user): bool
    {
        return $this->activeOrganizationId() !== null
            && $user->hasAnyRole([Role::Owner->value, Role::Admin->value]);
    }

    private function belongsToActiveOrganization(Channel $channel): bool
    {
        $activeId = $this->activeOrganizationId();

        return $activeId !== null && $channel->organization_id === $activeId;
    }

    private function activeOrganizationId(): ?int
    {
        return app(CurrentOrganization::class)->id();
    }
}
