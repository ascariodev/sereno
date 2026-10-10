<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Http\Requests\ProjectMember\StoreProjectMemberRequest;
use App\Http\Resources\MemberResource;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class ProjectMemberController extends Controller
{
    public function index(Project $project): AnonymousResourceCollection
    {
        Gate::authorize('view', $project);

        $organization = app(CurrentOrganization::class)->get();
        $assignedIds = $project->members()->pluck('users.id')->all();

        $viewers = $organization->users()->with('roles')->orderBy('name')->orderBy('users.id')->get()
            ->filter(fn (User $user) => match ($user->roles->first()?->name) {
                Role::Owner->value, Role::Admin->value => true,
                Role::Member->value => in_array($user->id, $assignedIds, true),
                default => false,
            })
            ->values();

        return MemberResource::collection($viewers);
    }

    public function store(StoreProjectMemberRequest $request, Project $project): MemberResource
    {
        $user = User::query()->findOrFail($request->integer('user_id'));

        $this->assign($project, $user);

        return $this->resource($user);
    }

    public function destroy(Project $project, User $user): Response
    {
        Gate::authorize('manageMembers', $project);

        $organization = app(CurrentOrganization::class)->get();

        abort_unless($organization->users()->whereKey($user->id)->exists(), 404);

        if (! $user->hasRole(Role::Member->value)) {
            throw ValidationException::withMessages([
                'user' => __('Only members of the organization can be removed from a project.'),
            ]);
        }

        $this->unassign($project, $user);

        return response()->noContent();
    }

    /** Single place for granting access; the side effects of gaining access hook in here. */
    private function assign(Project $project, User $user): void
    {
        $project->addMember($user);
    }

    /** Single place for revoking access; the side effects of losing access hook in here. */
    private function unassign(Project $project, User $user): void
    {
        $project->removeMember($user);
    }

    private function resource(User $user): MemberResource
    {
        $member = app(CurrentOrganization::class)->get()->users()->with('roles')->whereKey($user->id)->firstOrFail();

        return new MemberResource($member);
    }
}
