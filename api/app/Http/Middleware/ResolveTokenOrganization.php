<?php

namespace App\Http\Middleware;

use App\Models\McpOauthGrant;
use App\Models\PersonalAccessToken;
use App\Support\CurrentOrganization;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Passport\AccessToken;
use Symfony\Component\HttpFoundation\Response;

class ResolveTokenOrganization
{
    public const ABILITY = 'mcp';

    public const OAUTH_SCOPE = 'mcp:use';

    public function __construct(private CurrentOrganization $currentOrganization) {}

    public function handle(Request $request, Closure $next): Response
    {
        // Clear any organization left by a previous request in the same process (e.g. between tests).
        $this->currentOrganization->set(null);

        $user = $request->user();

        if ($user === null) {
            throw new AuthenticationException;
        }

        $token = $user->currentAccessToken();

        if ($token instanceof AccessToken && $token->can(self::OAUTH_SCOPE)) {
            // Read on every request: a new approval moves the client's tokens to the organization chosen there.
            $organizationId = McpOauthGrant::query()
                ->where('client_id', $token->oauth_client_id)
                ->where('user_id', $user->getKey())
                ->value('organization_id');
        } elseif ($token instanceof PersonalAccessToken && $token->isAccessToken() && $token->can(self::ABILITY)) {
            // Session tokens carry the '*' ability, so the ability alone does not tell them apart from access tokens.
            $organizationId = $token->organization_id;
        } else {
            return $this->forbidden(__('The MCP server only accepts access tokens.'), 'access_token_required');
        }

        $organization = $organizationId === null ? null : $user->organizations()->whereKey($organizationId)->first();

        if ($organization === null) {
            return $this->forbidden(__('You do not belong to this organization.'), 'organization_forbidden');
        }

        $this->currentOrganization->set($organization);
        $user->unsetRelation('roles');

        return $next($request);
    }

    private function forbidden(string $message, string $code): JsonResponse
    {
        return response()->json(['message' => $message, 'code' => $code], 403);
    }
}
