<?php

namespace App\Http\Middleware;

use App\Enums\Locale;
use App\Support\PassportGuards;
use Closure;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetLocale
{
    public function handle(Request $request, Closure $next, string ...$guards): Response
    {
        $locale = $this->resolve($request, $guards ?: ['sanctum']);

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

    /**
     * @param  list<string>  $guards
     */
    private function resolve(Request $request, array $guards): Locale
    {
        $preferred = str_starts_with((string) $request->bearerToken(), 'wsk_')
            ? null
            : $this->user($request, $guards)?->locale;

        if ($preferred instanceof Locale) {
            return $preferred;
        }

        $fromHeader = $request->getPreferredLanguage(Locale::values());

        return Locale::tryFrom((string) $fromHeader) ?? Locale::default();
    }

    /**
     * @param  list<string>  $guards
     */
    private function user(Request $request, array $guards): ?Authenticatable
    {
        foreach (PassportGuards::usable($guards) as $guard) {
            if ($user = $request->user($guard)) {
                return $user;
            }
        }

        return null;
    }
}
