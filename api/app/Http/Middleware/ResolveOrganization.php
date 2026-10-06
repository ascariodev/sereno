<?php

namespace App\Http\Middleware;

use App\Support\CurrentOrganization;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveOrganization
{
    public const HEADER = 'X-Organization-Id';

    public function __construct(private CurrentOrganization $currentOrganization) {}

    public function handle(Request $request, Closure $next): Response
    {
        // Clear any organization left by a previous request in the same process (tests, Octane).
        $this->currentOrganization->set(null);

        if ($request->user() === null) {
            throw new AuthenticationException;
        }

        $organizationId = $request->header(self::HEADER);

        if (! is_string($organizationId) || ! ctype_digit($organizationId)) {
            return response()->json(['message' => __('The :header header is missing or invalid.', ['header' => self::HEADER])], 400);
        }

        $organization = $request->user()->organizations()->whereKey((int) $organizationId)->first();

        if ($organization === null) {
            return response()->json(['message' => __('You do not belong to this organization.')], 403);
        }

        $this->currentOrganization->set($organization);
        $request->user()->unsetRelation('roles');

        return $next($request);
    }
}
