<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

class OAuthDiscoveryController extends Controller
{
    public function authorizationServer(): JsonResponse
    {
        return response()->json(array_filter([
            'issuer' => config('mcp.authorization_server') ?? url('/'),
            'authorization_endpoint' => rtrim((string) config('app.frontend_url'), '/').'/oauth/authorize',
            'token_endpoint' => route('passport.token'),
            'registration_endpoint' => route('mcp.oauth.register'),
            'response_types_supported' => ['code'],
            'code_challenge_methods_supported' => ['S256'],
            'scopes_supported' => ['mcp:use'],
            'grant_types_supported' => ['authorization_code', 'refresh_token'],
            'token_endpoint_auth_methods_supported' => ['none'],
        ]));
    }
}
