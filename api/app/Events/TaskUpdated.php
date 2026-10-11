<?php

namespace App\Events;

class TaskUpdated extends TaskSnapshotEvent
{
    public function broadcastAs(): string
    {
        return 'task.updated';
    }
}
