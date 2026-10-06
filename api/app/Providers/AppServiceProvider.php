<?php

namespace App\Providers;

use App\Http\Middleware\AuthenticateLogSource;
use App\Support\CurrentOrganization;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    public const LOGIN_ATTEMPTS_PER_MINUTE = 5;

    public const LOGIN_ATTEMPTS_PER_IP_PER_MINUTE = 20;

    public const REGISTER_ATTEMPTS_PER_MINUTE = 5;

    public const LOG_INGEST_REQUESTS_PER_MINUTE = 600;

    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->scoped(CurrentOrganization::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureRateLimiting();
    }

    private function configureRateLimiting(): void
    {
        // Email + IP so an attacker cannot lock out a user from another IP and users sharing
        // an IP do not block each other; the higher per-IP limit stops credential stuffing.
        RateLimiter::for('login', function (Request $request) {
            $email = $request->input('email');
            $email = is_string($email) ? Str::lower($email) : '';

            return [
                Limit::perMinute(self::LOGIN_ATTEMPTS_PER_MINUTE)
                    ->by('email-ip:'.$email.'|'.$request->ip())
                    ->response($this->tooManyAttemptsResponse(...)),
                Limit::perMinute(self::LOGIN_ATTEMPTS_PER_IP_PER_MINUTE)
                    ->by('ip:'.$request->ip())
                    ->response($this->tooManyAttemptsResponse(...)),
            ];
        });

        RateLimiter::for('register', fn (Request $request) => Limit::perMinute(self::REGISTER_ATTEMPTS_PER_MINUTE)
            ->by($request->ip())
            ->response($this->tooManyAttemptsResponse(...)));

        // Per source, not per IP: many systems may share an egress IP and the key identifies the sender.
        RateLimiter::for('log-ingest', fn (Request $request) => Limit::perMinute(self::LOG_INGEST_REQUESTS_PER_MINUTE)
            ->by('log-source:'.AuthenticateLogSource::source($request)->getKey())
            ->response($this->tooManyAttemptsResponse(...)));
    }

    private function tooManyAttemptsResponse(Request $request, array $headers): JsonResponse
    {
        return response()->json([
            'message' => __('Too many attempts. Please try again in :seconds seconds.', [
                'seconds' => $headers['Retry-After'] ?? 60,
            ]),
        ], 429, $headers);
    }
}
