<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Http\Requests\Member\UpdateMemberRoleRequest;
use App\Http\Resources\MemberResource;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class MemberController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', User::class);

        return MemberResource::collection(
            app(CurrentOrganization::class)->get()->users()->with('roles')->orderBy('name')->orderBy('users.id')->get(),
        );
    }

    public function update(UpdateMemberRoleRequest $request, User $user): MemberResource
    {
        $organization = app(CurrentOrganization::class)->get();

        $organization->changeMemberRole($user, Role::from($request->validated('role')));

        return new MemberResource($organization->users()->with('roles')->whereKey($user->id)->firstOrFail());
    }

    public function destroy(User $user): Response
    {
        Gate::authorize('remove', $user);

        app(CurrentOrganization::class)->get()->removeMember($user);

        return response()->noContent();
    }
}
