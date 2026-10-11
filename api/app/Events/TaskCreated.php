<?php

namespace App\Events;

class TaskCreated extends TaskSnapshotEvent
{
    public function broadcastAs(): string
    {
        return 'task.created';
    }
}
