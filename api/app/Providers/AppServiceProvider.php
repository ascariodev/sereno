<?php

namespace App\Providers;

use App\Enums\LogSourceKind;
use App\Http\Controllers\OAuthRegisterController;
use App\Http\Middleware\AuthenticateLogSource;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Policies\MemberPolicy;
use App\Support\CurrentOrganization;
use App\Support\ExpoPushSender;
use App\Support\MobilePushSender;
use App\Support\PushSender;
use App\Support\WebPushSender;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Laravel\Mcp\Server\Http\Controllers\OAuthRegisterController as BaseOAuthRegisterController;
use Laravel\Passport\AccessToken;
use Laravel\Passport\Passport;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    public const LOGIN_ATTEMPTS_PER_MINUTE = 5;

    public const LOGIN_ATTEMPTS_PER_IP_PER_MINUTE = 20;

    public const REGISTER_ATTEMPTS_PER_MINUTE = 5;

    public const LOG_INGEST_REQUESTS_PER_MINUTE = 600;

    public const LOG_INGEST_BROWSER_REQUESTS_PER_IP_PER_MINUTE = 30;

    public const CHANNEL_MESSAGES_PER_MINUTE = 30;

    public const INVITATION_PREVIEWS_PER_MINUTE = 30;

    public const NOTIFICATIONS_PER_MINUTE = 60;

    public const CHAT_ATTACHMENTS_PER_MINUTE = 20;

    public const ATTACHMENT_DOWNLOADS_PER_MINUTE = 300;

    public const ATTACHMENT_URLS_PER_MINUTE = 120;

    public const MCP_REQUESTS_PER_MINUTE = 120;

    public const OAUTH_REGISTRATIONS_PER_MINUTE = 10;

    // Claude connectors refresh from shared egress IPs, so the token endpoint gets a wider budget than registration.
    public const OAUTH_TOKEN_REQUESTS_PER_MINUTE = 60;

    public const OAUTH_AUTHORIZE_REQUESTS_PER_MINUTE = 30;

    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Only /oauth/token is kept (routes/ai.php); the session-based authorize and device routes do not fit a SPA.
        Passport::ignoreRoutes();
        $this->app->scoped(CurrentOrganization::class);
        $this->app->bind(PushSender::class, WebPushSender::class);
        $this->app->bind(MobilePushSender::class, ExpoPushSender::class);
        $this->app->bind(BaseOAuthRegisterController::class, OAuthRegisterController::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);
        Passport::tokensCan(['mcp:use' => 'Use the Sereno MCP server']);
        Gate::policy(User::class, MemberPolicy::class);
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
        // A browser key is public, so each visitor's IP also gets its own share of the source.
        RateLimiter::for('log-ingest', function (Request $request) {
            $source = AuthenticateLogSource::source($request);

            $limits = [
                Limit::perMinute(self::LOG_INGEST_REQUESTS_PER_MINUTE)
                    ->by('log-source:'.$source->getKey())
                    ->response($this->tooManyAttemptsResponse(...)),
            ];

            if ($source->kind === LogSourceKind::Browser) {
                $limits[] = Limit::perMinute(self::LOG_INGEST_BROWSER_REQUESTS_PER_IP_PER_MINUTE)
                    ->by('log-source-ip:'.$source->getKey().'|'.$request->ip())
                    ->response($this->tooManyAttemptsResponse(...));
            }

            return $limits;
        });

        RateLimiter::for('channel-messages', fn (Request $request) => Limit::perMinute(self::CHANNEL_MESSAGES_PER_MINUTE)
            ->by('user:'.$request->user()->getKey())
            ->response($this->tooManyAttemptsResponse(...)));

        RateLimiter::for('chat-attachments', fn (Request $request) => Limit::perMinute(self::CHAT_ATTACHMENTS_PER_MINUTE)
            ->by('user:'.$request->user()->getKey())
            ->response($this->tooManyAttemptsResponse(...)));

        // Per IP: the route has no user. Generous because a channel page loads every image at once.
        RateLimiter::for('attachment-downloads', fn (Request $request) => Limit::perMinute(self::ATTACHMENT_DOWNLOADS_PER_MINUTE)
            ->by('ip:'.$request->ip())
            ->response($this->tooManyAttemptsResponse(...)));

        RateLimiter::for('attachment-urls', fn (Request $request) => Limit::perMinute(self::ATTACHMENT_URLS_PER_MINUTE)
            ->by('user:'.$request->user()->getKey())
            ->response($this->tooManyAttemptsResponse(...)));

        RateLimiter::for('notifications', fn (Request $request) => Limit::perMinute(self::NOTIFICATIONS_PER_MINUTE)
            ->by('user:'.$request->user()->getKey())
            ->response($this->tooManyAttemptsResponse(...)));

        // Keyed on the access or OAuth token, so each Claude connection has its own budget.
        RateLimiter::for('mcp', function (Request $request) {
            $token = $request->user()->currentAccessToken();
            $key = $token instanceof AccessToken
                ? 'mcp-oauth:'.$token->oauth_access_token_id
                : 'mcp-token:'.$token->getKey();

            return Limit::perMinute(self::MCP_REQUESTS_PER_MINUTE)
                ->by($key)
                ->response($this->tooManyAttemptsResponse(...));
        });

        RateLimiter::for('oauth-register', fn (Request $request) => Limit::perMinute(self::OAUTH_REGISTRATIONS_PER_MINUTE)
            ->by('ip:'.$request->ip())
            ->response($this->tooManyAttemptsResponse(...)));

        RateLimiter::for('oauth-token', fn (Request $request) => Limit::perMinute(self::OAUTH_TOKEN_REQUESTS_PER_MINUTE)
            ->by('ip:'.$request->ip())
            ->response($this->tooManyAttemptsResponse(...)));

        RateLimiter::for('oauth-authorize', fn (Request $request) => Limit::perMinute(self::OAUTH_AUTHORIZE_REQUESTS_PER_MINUTE)
            ->by('user:'.$request->user()->getKey())
            ->response($this->tooManyAttemptsResponse(...)));

        RateLimiter::for('invitation-preview', fn (Request $request) => Limit::perMinute(self::INVITATION_PREVIEWS_PER_MINUTE)
            ->by('ip:'.$request->ip())
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
