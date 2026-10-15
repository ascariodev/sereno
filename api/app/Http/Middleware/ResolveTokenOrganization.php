<?php

namespace App\Http\Middleware;

use App\Models\PersonalAccessToken;
use App\Support\CurrentOrganization;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveTokenOrganization
{
    public const ABILITY = 'mcp';

    public function __construct(private CurrentOrganization $currentOrganization) {}

    public function handle(Request $request, Closure $next): Response
    {
        // Clear any organization left by a previous request in the same process (e.g. between tests).
        $this->currentOrganization->set(null);

        $user = $request->user();

        if ($user === null) {
            throw new AuthenticationException;
        }

        // Session tokens carry the '*' ability, so the ability alone does not tell them apart from access tokens.
        $token = $user->currentAccessToken();

        if (! $token instanceof PersonalAccessToken || ! $token->isAccessToken() || $token->cant(self::ABILITY)) {
            return response()->json(['message' => __('The MCP server only accepts access tokens.'), 'code' => 'access_token_required'], 403);
        }

        $organization = $user->organizations()->whereKey($token->organization_id)->first();

        if ($organization === null) {
            return response()->json(['message' => __('You do not belong to this organization.'), 'code' => 'organization_forbidden'], 403);
        }

        $this->currentOrganization->set($organization);
        $user->unsetRelation('roles');

        return $next($request);
    }
}
