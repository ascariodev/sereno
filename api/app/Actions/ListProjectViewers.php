<?php

namespace App\Actions;

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;

class ListProjectViewers
{
    /**
     * Owners and admins of the organization plus the members assigned to the project, by name.
     *
     * @return Collection<int, User>
     */
    public function __invoke(Organization $organization, Project $project): Collection
    {
        $assignedIds = $project->members()->pluck('users.id')->all();

        return $organization->users()
            ->where(fn ($query) => $query
                ->whereHas('roles', fn ($roles) => $roles->whereIn('roles.name', [Role::Owner->value, Role::Admin->value]))
                ->orWhere(fn ($assigned) => $assigned
                    ->whereIn('users.id', $assignedIds)
                    ->whereHas('roles', fn ($roles) => $roles->where('roles.name', Role::Member->value))))
            ->with('roles')
            ->orderBy('name')
            ->orderBy('users.id')
            ->get();
    }
}
