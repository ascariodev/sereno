<?php

namespace App\Http\Resources;

use App\Models\Message;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Message */
class MessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'channel_id' => $this->channel_id,
            'kind' => $this->kind,
            'body' => $this->body,
            'payload' => $this->payload,
            'log_group_id' => $this->log_group_id,
            'parent_id' => $this->parent_id,
            'replies_count' => $this->replies_count ?? 0,
            'last_reply_at' => $this->last_reply_at,
            'user' => $this->whenLoaded('user', fn () => $this->user === null ? null : [
                'id' => $this->user->id,
                'name' => $this->user->name,
            ]),
            'mentions' => $this->whenLoaded('mentionedUsers', fn () => $this->mentionedUsers
                ->map(fn ($user) => ['id' => $user->id, 'name' => $user->name])->values()->all()),
            'created_at' => $this->created_at,
        ];
    }
}
