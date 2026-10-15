<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\AccessToken\StoreAccessTokenRequest;
use App\Http\Resources\AccessTokenResource;
use App\Models\PersonalAccessToken;
use App\Support\CurrentOrganization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class AccessTokenController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return AccessTokenResource::collection(
            $this->ownTokens($request)->orderByDesc('created_at')->orderByDesc('id')->get(),
        );
    }

    public function store(StoreAccessTokenRequest $request): JsonResponse
    {
        $days = $request->validated('expires_in_days');

        $new = $request->user()->createAccessToken(
            app(CurrentOrganization::class)->get(),
            $request->validated('name'),
            $days === null ? null : now()->addDays($days),
        );

        return response()->json([
            'data' => (new AccessTokenResource($new->accessToken))->resolve($request),
            'token' => $new->plainTextToken,
        ], 201);
    }

    public function destroy(Request $request, int $id): Response
    {
        $this->ownTokens($request)->whereKey($id)->firstOrFail()->delete();

        return response()->noContent();
    }

    private function ownTokens(Request $request): Builder
    {
        return PersonalAccessToken::query()
            ->where('tokenable_type', $request->user()->getMorphClass())
            ->where('tokenable_id', $request->user()->getKey())
            ->where('organization_id', app(CurrentOrganization::class)->id());
    }
}
