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
        $this->addVaryAcceptLanguage($response);

        return $response;
    }

    private function addVaryAcceptLanguage(Response $response): void
    {
        $vary = $response->headers->all('Vary');

        foreach ($vary as $value) {
            if ($value === '*' || in_array('accept-language', array_map('trim', explode(',', strtolower($value))), true)) {
                return;
            }
        }

        $response->headers->set('Vary', [...$vary, 'Accept-Language']);
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
