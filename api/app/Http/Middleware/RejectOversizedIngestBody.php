<?php

namespace App\Http\Middleware;

use App\Http\Requests\LogIngest\IngestEventsRequest;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Global and first in the stack: the input-transforming middleware decodes the JSON body, so the size
 * has to be checked before any of them runs.
 */
class RejectOversizedIngestBody
{
    public function __construct(private SetLocale $setLocale) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->is('api/ingest/events') || ! $this->exceedsLimit($request)) {
            return $next($request);
        }

        return $this->setLocale->handle($request, fn () => response()->json([
            'message' => __('The request body is too large.'),
        ], 413));
    }

    private function exceedsLimit(Request $request): bool
    {
        $declared = $request->headers->get('Content-Length');

        if ($declared !== null && ctype_digit($declared)) {
            return (int) $declared > IngestEventsRequest::MAX_BODY_BYTES;
        }

        return strlen($request->getContent()) > IngestEventsRequest::MAX_BODY_BYTES;
    }
}
