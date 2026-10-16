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
        // Runs on every api route. It only inspects a user already resolved on the sanctum guard: auth:sanctum does it
        // on protected routes and SetLocale (which reads the user's locale) does it on any route, public ones included,
        // so an access token also gets 403 there. Sanctum::actingAs gives a TransientToken, never an access token.
        $guard = Auth::guard('sanctum');
        $token = $guard->hasUser() ? $guard->user()?->currentAccessToken() : null;

        if ($token instanceof PersonalAccessToken && $token->isAccessToken()) {
            return response()->json(['message' => __('Access tokens only work with the MCP server.'), 'code' => 'access_token_forbidden'], 403);
        }

        return $next($request);
    }
}
