<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\ListMessagesRequest;
use App\Http\Requests\Channel\StoreMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Channel;
use App\Models\Message;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

class MessageController extends Controller
{
    public function index(ListMessagesRequest $request, Channel $channel): AnonymousResourceCollection
    {
        return MessageResource::collection(
            $channel->messages()
                ->whereNull('parent_id')
                ->with('user:id,name')
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage())
                ->withQueryString(),
        );
    }

    public function replies(ListMessagesRequest $request, Channel $channel, Message $message): AnonymousResourceCollection
    {
        abort_unless($message->channel_id === $channel->id && $message->parent_id === null, 404);

        return MessageResource::collection(
            $channel->messages()
                ->where('parent_id', $message->id)
                ->with('user:id,name')
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage())
                ->withQueryString(),
        );
    }

    public function store(StoreMessageRequest $request, Channel $channel): MessageResource
    {
        $parentId = $request->validated('parent_id');

        $message = DB::transaction(function () use ($request, $channel, $parentId) {
            $message = new Message([
                'kind' => Message::KIND_USER,
                'body' => $request->validated('body'),
            ]);
            $message->channel()->associate($channel);
            $message->user()->associate($request->user());
            $message->parent_id = $parentId;
            $message->save();

            if ($parentId !== null) {
                Message::query()->whereKey($parentId)->update([
                    'replies_count' => DB::raw('replies_count + 1'),
                    'last_reply_at' => $message->created_at,
                ]);
            }

            return $message;
        });

        return new MessageResource($message->load('user:id,name'));
    }
}
