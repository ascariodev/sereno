<?php

namespace App\Actions;

use App\Enums\LogGroupStatus;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\User;

class PostLogGroupStatusNotice
{
    public function __invoke(LogGroup $group, LogGroupStatus $previousStatus, User $actor): void
    {
        $channel = Channel::query()
            ->where('project_id', $group->project_id)
            ->whereNull('archived_at')
            ->first();

        if ($channel === null) {
            return;
        }

        $message = new Message([
            'kind' => Message::KIND_SYSTEM,
            'payload' => [
                'type' => 'log.group_status_changed',
                'log_group_id' => $group->id,
                'title' => $group->title,
                'status' => $group->status->value,
                'previous_status' => $previousStatus->value,
            ],
        ]);
        $message->forceFill([
            'organization_id' => $group->organization_id,
            'channel_id' => $channel->id,
            'user_id' => $actor->id,
            'log_group_id' => $group->id,
        ])->save();
    }
}
