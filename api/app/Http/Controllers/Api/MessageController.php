<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\ListMessagesRequest;
use App\Http\Resources\MessageResource;
use App\Models\Channel;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MessageController extends Controller
{
    public function index(ListMessagesRequest $request, Channel $channel): AnonymousResourceCollection
    {
        return MessageResource::collection(
            $channel->messages()
                ->with('user:id,name')
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage())
                ->withQueryString(),
        );
    }
}
