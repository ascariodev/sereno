<?php

namespace App\Http\Middleware;

use App\Models\PersonalAccessToken;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class RejectAccessTokens
{
    public function handle(Request $request, Closure $next): Response
    {
        // Runs on every api route: only a user that auth:sanctum already resolved is inspected, so public routes
        // trigger no token lookup. Sanctum::actingAs gives a TransientToken, which is never an access token.
        $guard = Auth::guard('sanctum');
        $token = $guard->hasUser() ? $guard->user()?->currentAccessToken() : null;

        if ($token instanceof PersonalAccessToken && $token->isAccessToken()) {
            return response()->json(['message' => __('Access tokens only work with the MCP server.'), 'code' => 'access_token_forbidden'], 403);
        }

        return $next($request);
    }
}
