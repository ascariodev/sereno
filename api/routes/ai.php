<?php

use App\Http\Controllers\OAuthDiscoveryController;
use App\Http\Middleware\ResolveTokenOrganization;
use App\Http\Middleware\SetLocale;
use App\Mcp\Servers\SerenoServer;
use Illuminate\Support\Facades\Route;
use Laravel\Mcp\Facades\Mcp;

// The package skips its own authorization-server document when an exact GET route exists, and its nested
// route is overridden below, so every discovery path serves ours (authorization_endpoint lives in the web app).
Route::get('/.well-known/oauth-authorization-server', [OAuthDiscoveryController::class, 'authorizationServer'])
    ->name('mcp.oauth.authorization-server');

Mcp::oauthRoutes();

Route::get('/.well-known/oauth-authorization-server/{path}', [OAuthDiscoveryController::class, 'authorizationServer'])
    ->where('path', '.*')
    ->name('mcp.oauth.authorization-server.nested');

// laravel/mcp loads this file outside the api group, so RejectAccessTokens does not run here.
Mcp::web('/mcp', SerenoServer::class)->middleware([
    SetLocale::class,
    'auth:sanctum',
    ResolveTokenOrganization::class,
    'throttle:mcp',
]);
