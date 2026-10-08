<?php

namespace App\Http\Resources;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property array{from: CarbonImmutable, hours: int, counts: array<int, list<int>>} $resource */
class LogGroupHourlyResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'from' => $this->resource['from']->toJSON(),
            'hours' => $this->resource['hours'],
            'counts' => (object) $this->resource['counts'],
        ];
    }
}
