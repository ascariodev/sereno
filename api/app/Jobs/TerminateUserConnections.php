<?php

namespace App\Jobs;

use App\Realtime\ConnectionTerminator;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Idempotent: closing the sockets of a user with none open does nothing, so retries are safe.
 */
class TerminateUserConnections implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 4;

    /** @var list<int> */
    public array $backoff = [5, 15, 60];

    public function __construct(public readonly int $userId) {}

    /**
     * Delayed so the event that explains the cut reaches the client before its sockets close; a queue failure
     * is reported but must not fail a change that is already committed.
     */
    public static function scheduleAfterCommit(int $userId): void
    {
        DB::afterCommit(function () use ($userId) {
            try {
                static::dispatch($userId)->delay(5);
            } catch (Throwable $e) {
                report($e);
            }
        });
    }

    public function handle(ConnectionTerminator $terminator): void
    {
        $terminator->terminate($this->userId);
    }
}
