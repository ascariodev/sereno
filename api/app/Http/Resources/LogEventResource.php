<?php

namespace App\Http\Resources;

use App\Models\LogEvent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin LogEvent */
class LogEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'level' => $this->level,
            'message' => $this->message,
            'context' => $this->context,
            'occurred_at' => $this->occurred_at,
            'received_at' => $this->received_at,
        ];
    }
}
