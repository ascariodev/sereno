<?php

use App\Http\Middleware\ResolveTokenOrganization;
use App\Http\Middleware\SetLocale;
use App\Mcp\Servers\SerenoServer;
use Laravel\Mcp\Facades\Mcp;

// laravel/mcp loads this file outside the api group, so RejectAccessTokens does not run here.
Mcp::web('/mcp', SerenoServer::class)->middleware([
    SetLocale::class,
    'auth:sanctum',
    ResolveTokenOrganization::class,
    'throttle:mcp',
]);
