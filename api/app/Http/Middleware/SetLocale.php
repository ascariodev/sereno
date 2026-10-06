<?php

namespace App\Http\Middleware;

use App\Enums\Locale;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $locale = $this->resolve($request);

        app()->setLocale($locale->value);

        $response = $next($request);
        $response->headers->set('Content-Language', $locale->value);

        return $response;
    }

    private function resolve(Request $request): Locale
    {
        $preferred = $request->user('sanctum')?->locale;

        if ($preferred instanceof Locale) {
            return $preferred;
        }

        $fromHeader = $request->getPreferredLanguage(Locale::values());

        return Locale::tryFrom((string) $fromHeader) ?? Locale::default();
    }
}
