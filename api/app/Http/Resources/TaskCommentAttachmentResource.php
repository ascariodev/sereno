<?php

namespace App\Http\Resources;

use App\Models\TaskCommentAttachment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin TaskCommentAttachment */
class TaskCommentAttachmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'original_name' => $this->original_name,
            'mime' => $this->mime,
            'size' => $this->size,
            'created_at' => $this->created_at,
            'url' => $this->downloadUrl(),
        ];
    }
}
