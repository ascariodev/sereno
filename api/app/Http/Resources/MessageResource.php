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
        $deleted = $this->deleted_at !== null;

        return [
            'id' => $this->id,
            'channel_id' => $this->channel_id,
            'kind' => $this->kind,
            'body' => $deleted ? null : $this->body,
            'payload' => $this->payload,
            'log_group_id' => $this->log_group_id,
            'parent_id' => $this->parent_id,
            'replies_count' => $this->replies_count ?? 0,
            'last_reply_at' => $this->last_reply_at,
            // Latest distinct reply authors, newest first; only set by the list endpoints.
            'recent_participants' => $this->whenLoaded('recentParticipants', fn () => $this->recentParticipants
                ->map(fn ($user) => ['id' => $user->id, 'name' => $user->name])->values()->all(), []),
            'user' => $this->whenLoaded('user', fn () => $this->user === null ? null : [
                'id' => $this->user->id,
                'name' => $this->user->name,
            ]),
            'mentions' => $this->whenLoaded('mentionedUsers', fn () => $deleted ? [] : $this->mentionedUsers
                ->map(fn ($user) => ['id' => $user->id, 'name' => $user->name])->values()->all()),
            // Messages broadcast as they are created (log notices) carry no attachments, so the
            // default avoids a query in the queue worker, which has no active organization.
            'attachments' => $this->whenLoaded('attachments', fn () => $deleted ? [] : $this->attachments->sortBy('id')
                ->map(fn ($attachment) => (new MessageAttachmentResource($attachment))->resolve($request))->values()->all(), []),
            'created_at' => $this->created_at,
            'edited_at' => $this->edited_at,
            'deleted_at' => $this->deleted_at,
        ];
    }
}
