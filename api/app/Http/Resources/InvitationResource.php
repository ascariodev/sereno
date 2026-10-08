<?php

namespace App\Http\Resources;

use App\Models\Invitation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Invitation */
class InvitationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'role' => $this->role,
            'locale' => $this->locale,
            'invited_by' => $this->whenLoaded('inviter', fn () => $this->inviter === null
                ? null
                : ['id' => $this->inviter->id, 'name' => $this->inviter->name]),
            'expires_at' => $this->expires_at,
            'created_at' => $this->created_at,
        ];
    }
}
