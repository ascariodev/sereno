<?php

namespace App\Http\Resources;

use App\Models\LogSource;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin LogSource */
class LogSourceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'project_id' => $this->project_id,
            'name' => $this->name,
            'key_prefix' => $this->key_prefix,
            'last_used_at' => $this->last_used_at,
            'revoked_at' => $this->revoked_at,
            'created_at' => $this->created_at,
        ];
    }
}
