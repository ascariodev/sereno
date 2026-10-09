<?php

namespace App\Http\Resources;

use App\Models\MessageMention;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin MessageMention */
class MentionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'read_at' => $this->read_at,
            'created_at' => $this->created_at,
            'message' => new MessageResource($this->message),
            'channel' => [
                'id' => $this->message->channel->id,
                'name' => $this->message->channel->name,
                'project_id' => $this->message->channel->project_id,
            ],
            'parent_id' => $this->message->parent_id,
        ];
    }
}
