<?php

namespace App\Jobs;

use App\Models\LogSource;
use App\Models\Scopes\OrganizationScope;
use App\Support\LogEventRecorder;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * Encrypted because event contexts may carry customer data (emails, tokens) and `jobs` / `failed_jobs`
 * store the payload in clear text (L-06). Carries the source id, never the model or the key.
 */
class IngestLogEvents implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /** One attempt: a retry would record the already stored events again and over-count the groups. */
    public int $tries = 1;

    /**
     * @param  list<array{level: string, message: string, context?: array<mixed>|null, occurred_at?: string|null, fingerprint?: string|null}>  $events
     */
    public function __construct(public readonly int $sourceId, public readonly array $events) {}

    public function handle(LogEventRecorder $recorder): void
    {
        // A source revoked after the 202 still gets its accepted batch recorded; only a deleted one drops it.
        $source = LogSource::query()->withoutGlobalScope(OrganizationScope::class)->find($this->sourceId);

        if ($source === null) {
            return;
        }

        foreach ($this->events as $event) {
            $recorder->record($source, $event);
        }
    }
}
