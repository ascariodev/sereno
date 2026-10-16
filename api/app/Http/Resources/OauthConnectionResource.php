<?php

namespace App\Http\Resources;

use App\Models\McpOauthGrant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin McpOauthGrant */
class OauthConnectionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'client' => ['id' => $this->client->getKey(), 'name' => $this->client->name],
            'organization' => ['id' => $this->organization->id, 'name' => $this->organization->name],
            'created_at' => $this->created_at,
        ];
    }
}
