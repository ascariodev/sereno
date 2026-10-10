<?php

namespace App\Http\Resources;

use App\Models\Task;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Task */
class TaskResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'project_id' => $this->project_id,
            'key' => $this->key(),
            'number' => $this->number,
            'title' => $this->title,
            'description' => $this->description,
            'status' => $this->status,
            'position' => $this->position,
            'created_by' => $this->created_by,
            'assignee' => $this->whenLoaded('assignee', fn () => $this->assignee
                ? ['id' => $this->assignee->id, 'name' => $this->assignee->name]
                : null),
            'log_group' => $this->whenLoaded('logGroup', fn () => $this->logGroup
                ? [
                    'id' => $this->logGroup->id,
                    'level' => $this->logGroup->level,
                    'title' => $this->logGroup->title,
                    'status' => $this->logGroup->status,
                    'events_count' => $this->logGroup->events_count,
                ]
                : null),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
