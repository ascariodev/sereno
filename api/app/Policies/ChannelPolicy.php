<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Channel;
use App\Models\User;
use App\Policies\Concerns\ChecksActiveOrganization;
use App\Support\ProjectAccess;
use Illuminate\Auth\Access\Response;

/**
 * Roles are read from the active permission team, which ResolveOrganization sets.
 * Every check on an instance also requires it to belong to the active organization.
 */
class ChannelPolicy
{
    use ChecksActiveOrganization;

    public function viewAny(User $user): bool
    {
        return $this->hasActiveOrganization()
            && $user->hasAnyRole(array_column(Role::cases(), 'value'));
    }

    public function view(User $user, Channel $channel): Response|bool
    {
        if (! $this->belongsToActiveOrganization($channel) || ! $this->viewAny($user)) {
            return false;
        }

        if ($channel->project_id === null
            || ProjectAccess::canViewId($user, $channel->organization_id, $channel->project_id)) {
            return Response::allow();
        }

        return Response::denyAsNotFound();
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
}
