<?php

namespace App\Http\Resources;

use App\Models\LogGroup;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin LogGroup */
class LogGroupResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'project_id' => $this->project_id,
            'level' => $this->level,
            'title' => $this->title,
            'status' => $this->status,
            'events_count' => $this->events_count,
            'first_seen_at' => $this->first_seen_at,
            'last_seen_at' => $this->last_seen_at,
            'events' => LogEventResource::collection($this->whenLoaded('events')),
        ];
    }
}
