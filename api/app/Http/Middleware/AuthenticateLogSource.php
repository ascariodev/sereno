<?php

namespace App\Http\Middleware;

use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Scopes\OrganizationScope;
use App\Support\CurrentOrganization;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authenticates ingestion with a log source key (Authorization: Bearer wsk_...). Every failure is the
 * same 401 so the response does not reveal whether a key exists, is revoked or its project is archived.
 */
class AuthenticateLogSource
{
    public const ATTRIBUTE = 'logSource';

    public function __construct(private CurrentOrganization $currentOrganization) {}

    public function handle(Request $request, Closure $next): Response
    {
        // Clear any organization left by a previous request in the same process (L-02).
        $this->currentOrganization->set(null);

        // Checked before any query so an IP guessing keys gets blocked, even if it then sends a valid one.
        $failuresKey = 'log-ingest-auth-failures:'.$request->ip();

        if (RateLimiter::tooManyAttempts($failuresKey, config('workspace.log.auth_failures.max_attempts'))) {
            $retryAfter = RateLimiter::availableIn($failuresKey);

            return response()->json([
                'message' => __('Too many attempts. Please try again in :seconds seconds.', ['seconds' => $retryAfter]),
            ], 429, ['Retry-After' => $retryAfter]);
        }

        try {
            $source = $this->resolve($request->bearerToken());
        } catch (AuthenticationException $e) {
            RateLimiter::hit($failuresKey, config('workspace.log.auth_failures.decay_seconds'));

            throw $e;
        }

        $this->currentOrganization->set($source->organization);
        $request->attributes->set(self::ATTRIBUTE, $source);
        $source->markAsUsed();

        return $next($request);
    }

    public static function source(Request $request): LogSource
    {
        return $request->attributes->get(self::ATTRIBUTE);
    }

    private function resolve(?string $plainKey): LogSource
    {
        if ($plainKey === null || ! LogSource::isWellFormedPlainKey($plainKey)) {
            throw new AuthenticationException;
        }

        $source = LogSource::findByPlainKey($plainKey);

        if ($source === null || $source->isRevoked()) {
            throw new AuthenticationException;
        }

        // No active organization yet: the project and organization are read without the tenant scope.
        $project = Project::query()
            ->withoutGlobalScope(OrganizationScope::class)
            ->whereKey($source->project_id)
            ->first();
        $organization = Organization::query()->find($source->organization_id);

        if ($project === null || $project->isArchived() || $organization === null) {
            throw new AuthenticationException;
        }

        $source->setRelation('project', $project);
        $source->setRelation('organization', $organization);

        return $source;
    }
}
