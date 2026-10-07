<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\ListMessagesRequest;
use App\Http\Requests\Channel\StoreMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Channel;
use App\Models\Message;
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

    public function store(StoreMessageRequest $request, Channel $channel): MessageResource
    {
        $message = new Message([
            'kind' => Message::KIND_USER,
            'body' => $request->validated('body'),
        ]);
        $message->channel()->associate($channel);
        $message->user()->associate($request->user());
        $message->save();

        return new MessageResource($message->load('user:id,name'));
    }
}
