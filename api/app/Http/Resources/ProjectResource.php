<?php

namespace App\Http\Resources;

use App\Enums\LogLevel;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Project */
class ProjectResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'key' => $this->key,
            'description' => $this->description,
            'archived_at' => $this->archived_at,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'open_groups_count' => $this->whenHas('open_groups_count'),
            'open_max_level' => $this->whenHas(
                'open_max_severity',
                fn ($position) => $position === null ? null : LogLevel::fromSeverityPosition((int) $position)?->value,
            ),
        ];
    }
}
