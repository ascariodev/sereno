<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\OauthConnectionResource;
use App\Models\McpOauthGrant;
use App\Support\CurrentOrganization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class OauthConnectionController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return OauthConnectionResource::collection(
            $this->ownGrants($request)->with(['client', 'organization'])->orderByDesc('created_at')->orderByDesc('id')->get(),
        );
    }

    public function destroy(Request $request, int $id): Response
    {
        DB::transaction(fn () => $this->ownGrants($request)->whereKey($id)->firstOrFail()->revoke());

        return response()->noContent();
    }

    /** @return Builder<McpOauthGrant> */
    private function ownGrants(Request $request): Builder
    {
        return McpOauthGrant::query()
            ->where('user_id', $request->user()->getKey())
            ->where('organization_id', app(CurrentOrganization::class)->id());
    }
}
