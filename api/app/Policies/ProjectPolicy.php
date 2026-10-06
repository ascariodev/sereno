<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;

/**
 * Roles are read from the active permission team, which ResolveOrganization sets.
 * Every check also requires the project to belong to the active organization.
 */
class ProjectPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->hasActiveOrganization() && $user->hasAnyRole(array_column(Role::cases(), 'value'));
    }

    public function view(User $user, Project $project): bool
    {
        return $this->belongsToActiveOrganization($project) && $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->canManage($user);
    }

    public function update(User $user, Project $project): bool
    {
        return $this->belongsToActiveOrganization($project) && $this->canManage($user);
    }

    public function archive(User $user, Project $project): bool
    {
        return $this->update($user, $project);
    }

    private function canManage(User $user): bool
    {
        return $this->hasActiveOrganization()
            && $user->hasAnyRole([Role::Owner->value, Role::Admin->value]);
    }

    private function hasActiveOrganization(): bool
    {
        return app(CurrentOrganization::class)->id() !== null;
    }

    private function belongsToActiveOrganization(Project $project): bool
    {
        $activeId = app(CurrentOrganization::class)->id();

        return $activeId !== null && $project->organization_id === $activeId;
    }
}
