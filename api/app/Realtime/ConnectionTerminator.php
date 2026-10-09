<?php

namespace App\Realtime;

use Illuminate\Broadcasting\Broadcasters\PusherBroadcaster;
use Illuminate\Broadcasting\BroadcastManager;
use Pusher\ApiErrorException;

class ConnectionTerminator
{
    public function __construct(private BroadcastManager $broadcast) {}

    /**
     * Closes every Reverb/Pusher socket whose presence `user_id` matches; other drivers have no sockets to close.
     *
     * @throws ApiErrorException
     */
    public function terminate(int $userId): void
    {
        $broadcaster = $this->broadcast->connection();

        if (! $broadcaster instanceof PusherBroadcaster) {
            return;
        }

        $broadcaster->getPusher()->terminateUserConnections((string) $userId);
    }
}
