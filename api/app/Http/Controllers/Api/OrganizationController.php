<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Http\Requests\Organization\CreateOrganizationRequest;
use App\Http\Resources\OrganizationResource;
use App\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

class OrganizationController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return OrganizationResource::collection($request->user()->organizationsWithRoles());
    }

    public function store(CreateOrganizationRequest $request): JsonResponse
    {
        $user = $request->user();

        $organization = DB::transaction(function () use ($request, $user) {
            $organization = Organization::create([
                'name' => $request->validated('name'),
                'slug' => Organization::uniqueSlugFor($request->validated('name')),
            ]);

            $organization->addMember($user, [Role::Owner]);

            return $organization;
        });

        $user->unsetRelation('organizations')->unsetRelation('rolesInOrganizations');

        return (new OrganizationResource(
            $user->organizationsWithRoles()->firstWhere('id', $organization->id),
        ))->response()->setStatusCode(201);
    }
}
