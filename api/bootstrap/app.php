<?php

use App\Http\Middleware\AuthenticateLogSource;
use App\Http\Middleware\ResolveOrganization;
use App\Http\Middleware\SetLocale;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withBroadcasting(__DIR__.'/../routes/channels.php', ['middleware' => [SetLocale::class, 'auth:sanctum']])
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->api(append: [
            SetLocale::class,
        ]);
        $middleware->alias([
            'organization' => ResolveOrganization::class,
            'log.source' => AuthenticateLogSource::class,
        ]);
        // There is no login route to redirect to: guests always get the JSON 401 rendered in withExceptions.
        $middleware->redirectGuestsTo(fn () => null);
        // Locale first so auth, organization and throttle errors are translated.
        $middleware->prependToPriorityList(AuthenticatesRequests::class, SetLocale::class);
        $middleware->appendToPriorityList(AuthenticatesRequests::class, ResolveOrganization::class);
        // The log-ingest limiter keys on the source, so it must be resolved first.
        $middleware->prependToPriorityList(ThrottleRequests::class, AuthenticateLogSource::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $wantsJson = fn (Request $request): bool => $request->is('api/*', 'broadcasting/*') || $request->expectsJson();

        $exceptions->shouldRenderJsonWhen($wantsJson);
        $exceptions->render(fn (AuthenticationException $e, Request $request) => $wantsJson($request)
            ? response()->json(['message' => __('Unauthenticated.')], 401)
            : null);
    })->create();
