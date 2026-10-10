<?php

namespace App\Support;

use App\Enums\Role;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Who sees which project. Owners and admins of the organization see all of its projects; a member only the ones
 * assigned in project_user. Every method takes the organization explicitly and reads the role with that team,
 * so it works without an active organization (broadcasting auth, jobs).
 *
 * canViewId does not check that the project belongs to $organizationId (it would add a query per call on hot paths
 * such as mentions): the caller validates it, as ChannelChannel and ProjectChannel do, or takes both ids from the same row.
 */
class ProjectAccess
{
    public static function seesAll(User $user, int $organizationId): bool
    {
        return self::hasRole($user, $organizationId, [Role::Owner->value, Role::Admin->value]);
    }

    public static function canView(User $user, Project $project): bool
    {
        return self::canViewId($user, $project->organization_id, $project->id);
    }

    public static function canViewId(User $user, int $organizationId, int $projectId): bool
    {
        if (self::seesAll($user, $organizationId)) {
            return true;
        }

        return self::hasRole($user, $organizationId, [Role::Member->value])
            && DB::table('project_user')
                ->where('organization_id', $organizationId)
                ->where('user_id', $user->id)
                ->where('project_id', $projectId)
                ->exists();
    }

    /**
     * @return Collection<int, int>
     */
    public static function visibleProjectIds(User $user, int $organizationId): Collection
    {
        if (self::seesAll($user, $organizationId)) {
            return Project::withoutGlobalScopes()->where('organization_id', $organizationId)->pluck('id');
        }

        if (! self::hasRole($user, $organizationId, [Role::Member->value])) {
            return collect();
        }

        return DB::table('project_user')
            ->where('organization_id', $organizationId)
            ->where('user_id', $user->id)
            ->pluck('project_id');
    }

    /**
     * Limits a query on a table with a project column (projects.id, channels.project_id, tasks.project_id...) to
     * what the user sees. The query keeps its own organization filter; for owners and admins nothing is added.
     */
    public static function restrict(Builder $query, User $user, int $organizationId, string $projectColumn = 'projects.id'): Builder
    {
        if (self::seesAll($user, $organizationId)) {
            return $query;
        }

        return $query->whereIn($projectColumn, self::visibleProjectIds($user, $organizationId));
    }

    /**
     * @param  array<string>  $roles
     */
    private static function hasRole(User $user, int $organizationId, array $roles): bool
    {
        $previousTeam = getPermissionsTeamId();
        setPermissionsTeamId($organizationId);

        try {
            return $user->unsetRelation('roles')->hasAnyRole($roles);
        } finally {
            setPermissionsTeamId($previousTeam);
            $user->unsetRelation('roles');
        }
    }
}
