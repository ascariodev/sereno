<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\MemberResource;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
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
}
