<?php

namespace App\Jobs;

use App\Realtime\ConnectionTerminator;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

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

    public function handle(ConnectionTerminator $terminator): void
    {
        $terminator->terminate($this->userId);
    }
}
