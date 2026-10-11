<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\ListChannelsRequest;
use App\Http\Resources\ChannelResource;
use App\Models\Channel;
use App\Support\CurrentOrganization;
use App\Support\ProjectAccess;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class ChannelController extends Controller
{
    public function index(ListChannelsRequest $request): AnonymousResourceCollection
    {
        $organizationId = app(CurrentOrganization::class)->id();

        return ChannelResource::collection(
            ProjectAccess::restrict(
                Channel::query()
                    ->when(! $request->includeArchived(), fn ($query) => $query->whereNull('archived_at'))
                    ->whereNotNull('project_id')
                    ->with('project:id,name,key'),
                $request->user(),
                $organizationId,
                'channels.project_id',
            )
                ->orderBy('name')
                ->orderBy('id')
                ->cursorPaginate($request->perPage())
                ->withQueryString(),
        );
    }

    public function show(Channel $channel): ChannelResource
    {
        if ($channel->project_id === null || Gate::denies('view', $channel)) {
            throw new ModelNotFoundException;
        }

        return new ChannelResource($channel->load('project:id,name,key'));
    }
}
