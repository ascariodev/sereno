<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Events\ProjectAccessChanged;
use App\Http\Controllers\Controller;
use App\Http\Requests\ProjectMember\StoreProjectMemberRequest;
use App\Http\Resources\MemberResource;
use App\Jobs\TerminateUserConnections;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class ProjectMemberController extends Controller
{
    public function index(Project $project): AnonymousResourceCollection
    {
        Gate::authorize('view', $project);

        $organization = app(CurrentOrganization::class)->get();
        $assignedIds = $project->members()->pluck('users.id')->all();

        $viewers = $organization->users()
            ->where(fn ($query) => $query
                ->whereHas('roles', fn ($roles) => $roles->whereIn('roles.name', [Role::Owner->value, Role::Admin->value]))
                ->orWhere(fn ($assigned) => $assigned
                    ->whereIn('users.id', $assignedIds)
                    ->whereHas('roles', fn ($roles) => $roles->where('roles.name', Role::Member->value))))
            ->with('roles')
            ->orderBy('name')
            ->orderBy('users.id')
            ->get();

        return MemberResource::collection($viewers);
    }

    public function store(StoreProjectMemberRequest $request, Project $project): MemberResource
    {
        $user = User::query()->findOrFail($request->integer('user_id'));

        $this->assign($project, $user);

        return $this->resource($user);
    }

    public function destroy(Project $project, int $user): Response
    {
        Gate::authorize('manageMembers', $project);

        $organization = app(CurrentOrganization::class)->get();

        $user = $organization->users()->whereKey($user)->firstOrFail();

        $this->unassign($project, $user);

        return response()->noContent();
    }

    /** Single place for granting access; the side effects of gaining access hook in here. */
    private function assign(Project $project, User $user): void
    {
        $this->mutateAccess($project, $user, function () use ($project, $user) {
            $this->ensureMemberRole($user, 'user_id', __('Only users with the member role can be assigned to a project.'));

            if ($project->addMember($user)) {
                ProjectAccessChanged::dispatch($user->id, $project->organization_id, $project->id, true);
            }
        });
    }

    /**
     * Single place for revoking access; the side effects of losing access hook in here. Sockets are cut because
     * Reverb does not re-authorize the subscriptions already open to the project and its channel.
     */
    private function unassign(Project $project, User $user): void
    {
        $this->mutateAccess($project, $user, function () use ($project, $user) {
            $this->ensureMemberRole($user, 'user', __('Only users with the member role can be removed from a project.'));

            if (! $project->removeMember($user)) {
                return;
            }

            Task::unassignUser($project->organization_id, $user->id, $project->id);

            ProjectAccessChanged::dispatch($user->id, $project->organization_id, $project->id, false);
            TerminateUserConnections::scheduleAfterCommit($user->id);
        });
    }

    /**
     * Takes the same organization row lock as membership changes: only the request that changed access emits its
     * effects, and a user removed from the organization or whose role changed meanwhile is not assigned again: the
     * mutation reads the role under the lock, after any concurrent role change has committed.
     */
    private function mutateAccess(Project $project, User $user, callable $mutation): void
    {
        DB::transaction(function () use ($project, $user, $mutation) {
            $organization = Organization::query()->whereKey($project->organization_id)->lockForUpdate()->firstOrFail();

            if (! $organization->users()->whereKey($user->id)->exists()) {
                throw (new ModelNotFoundException)->setModel(User::class, [$user->id]);
            }

            $mutation();
        });
    }

    /** Reads the role fresh: a role loaded before the lock may be stale. */
    private function ensureMemberRole(User $user, string $field, string $message): void
    {
        if (! $user->unsetRelation('roles')->hasRole(Role::Member->value)) {
            throw ValidationException::withMessages([$field => $message]);
        }
    }

    private function resource(User $user): MemberResource
    {
        $member = app(CurrentOrganization::class)->get()->users()->with('roles')->whereKey($user->id)->firstOrFail();

        return new MemberResource($member);
    }
}
