<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use App\Support\ProjectAccess;
use Illuminate\Auth\Access\Response;

/**
 * Roles are read from the active permission team, which ResolveOrganization sets.
 * Every check on an instance also requires it to belong to the active organization.
 * A member only reaches tasks of the projects assigned to them; the rest answer 404.
 * Archived projects are rejected by the form requests, not here.
 */
class TaskPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->activeOrganizationId() !== null
            && $user->hasAnyRole(array_column(Role::cases(), 'value'));
    }

    public function view(User $user, Task $task): Response|bool
    {
        if ($task->organization_id !== $this->activeOrganizationId() || ! $this->viewAny($user)) {
            return false;
        }

        return ProjectAccess::canViewId($user, $task->organization_id, $task->project_id)
            ? Response::allow()
            : Response::denyAsNotFound();
    }

    public function create(User $user): bool
    {
        return $this->viewAny($user);
    }

    public function update(User $user, Task $task): Response|bool
    {
        return $this->view($user, $task);
    }

    public function delete(User $user, Task $task): Response|bool
    {
        $view = $this->view($user, $task);

        if ($view instanceof Response ? ! $view->allowed() : ! $view) {
            return $view;
        }

        return $task->created_by === $user->id || $user->hasAnyRole([Role::Owner->value, Role::Admin->value]);
    }

    private function activeOrganizationId(): ?int
    {
        return app(CurrentOrganization::class)->id();
    }
}
