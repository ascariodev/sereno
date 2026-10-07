<?php

namespace App\Http\Resources;

use App\Models\Channel;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Channel */
class ChannelResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'project_id' => $this->project_id,
            'name' => $this->name,
            'archived_at' => $this->archived_at,
            'created_at' => $this->created_at,
            'project' => new ProjectResource($this->whenLoaded('project')),
        ];
    }
}
