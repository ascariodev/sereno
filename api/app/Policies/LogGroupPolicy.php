<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\LogGroup;
use App\Models\User;
use App\Support\CurrentOrganization;
use App\Support\ProjectAccess;
use Illuminate\Auth\Access\Response;

/**
 * Roles are read from the active permission team, which ResolveOrganization sets.
 * Every check on an instance also requires it to belong to the active organization.
 * A member only reaches groups of the projects assigned to them; the rest answer 404.
 */
class LogGroupPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->activeOrganizationId() !== null
            && $user->hasAnyRole(array_column(Role::cases(), 'value'));
    }

    public function view(User $user, LogGroup $group): Response|bool
    {
        if ($group->organization_id !== $this->activeOrganizationId() || ! $this->viewAny($user)) {
            return false;
        }

        return ProjectAccess::canViewId($user, $group->organization_id, $group->project_id)
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    public function update(User $user, LogGroup $group): Response|bool
    {
        return $this->view($user, $group);
    }

    private function activeOrganizationId(): ?int
    {
        return app(CurrentOrganization::class)->id();
    }
}
