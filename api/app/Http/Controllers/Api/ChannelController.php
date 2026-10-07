<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\ListChannelsRequest;
use App\Http\Resources\ChannelResource;
use App\Models\Channel;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ChannelController extends Controller
{
    public function index(ListChannelsRequest $request): AnonymousResourceCollection
    {
        return ChannelResource::collection(
            Channel::query()
                ->whereNull('archived_at')
                ->whereNotNull('project_id')
                ->with('project')
                ->orderBy('name')
                ->orderBy('id')
                ->get(),
        );
    }
}
