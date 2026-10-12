<?php

namespace App\Http\Resources;

use App\Models\TaskComment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin TaskComment */
class TaskCommentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'task_id' => $this->task_id,
            'body' => $this->body,
            'user' => $this->whenLoaded('user', fn () => $this->user
                ? ['id' => $this->user->id, 'name' => $this->user->name]
                : null),
            'mentions' => $this->whenLoaded('mentionedUsers', fn () => $this->mentionedUsers
                ->sortBy('id')
                ->map(fn ($user) => ['id' => $user->id, 'name' => $user->name])
                ->values()),
            'attachments' => $this->whenLoaded('attachments', fn () => $this->attachments->sortBy('id')
                ->map(fn ($attachment) => (new TaskCommentAttachmentResource($attachment))->resolve($request))->values()->all()),
            'created_at' => $this->created_at,
        ];
    }
}
