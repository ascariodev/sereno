<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Middleware\AuthenticateLogSource;
use App\Http\Requests\LogIngest\IngestEventsRequest;
use App\Jobs\IngestLogEvents;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;

class LogIngestController extends Controller
{
    /** Tolerated client clock skew; later dates are clamped to the reception time. */
    private const MAX_FUTURE_SKEW_MINUTES = 5;

    public function store(IngestEventsRequest $request): JsonResponse
    {
        $source = AuthenticateLogSource::source($request);
        $now = Carbon::now('UTC');
        $limit = $now->copy()->addMinutes(self::MAX_FUTURE_SKEW_MINUTES);

        $events = array_map(function (array $event) use ($now, $limit) {
            $occurredAt = isset($event['occurred_at']) ? Carbon::parse($event['occurred_at'])->utc() : null;

            return [
                'level' => $event['level'],
                'message' => $event['message'],
                'context' => $event['context'] ?? null,
                'occurred_at' => ($occurredAt !== null && $occurredAt->greaterThan($limit) ? $now : $occurredAt)?->toIso8601String(),
                'fingerprint' => $event['fingerprint'] ?? null,
            ];
        }, array_values($request->validated('events')));

        IngestLogEvents::dispatch($source->getKey(), $events);

        return response()->json(['accepted' => count($events)], 202);
    }
}
