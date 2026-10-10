<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;

/**
 * Roles are read from the active permission team, which ResolveOrganization sets.
 * Every check on an instance also requires it to belong to the active organization.
 * Archived projects are rejected by the form requests, not here.
 */
class TaskPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->activeOrganizationId() !== null
            && $user->hasAnyRole(array_column(Role::cases(), 'value'));
    }

    public function view(User $user, Task $task): bool
    {
        return $task->organization_id === $this->activeOrganizationId() && $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->viewAny($user);
    }

    public function update(User $user, Task $task): bool
    {
        return $this->view($user, $task);
    }

    public function delete(User $user, Task $task): bool
    {
        return $this->view($user, $task)
            && ($task->created_by === $user->id || $user->hasAnyRole([Role::Owner->value, Role::Admin->value]));
    }

    private function activeOrganizationId(): ?int
    {
        return app(CurrentOrganization::class)->id();
    }
}
