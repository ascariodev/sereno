<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Mention\ListMentionsRequest;
use App\Http\Requests\Mention\MarkMentionsReadRequest;
use App\Http\Resources\MentionResource;
use App\Models\MessageMention;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MentionController extends Controller
{
    public function index(ListMentionsRequest $request): AnonymousResourceCollection
    {
        return MentionResource::collection(
            MessageMention::query()
                ->where('user_id', $request->user()->id)
                ->with(['message.user:id,name', 'message.mentionedUsers:id,name', 'message.attachments', 'message.channel:id,name,project_id'])
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage())
                ->withQueryString(),
        )->additional(['meta' => ['unread_count' => $this->unreadCount($request->user()->id)]]);
    }

    public function read(MarkMentionsReadRequest $request): JsonResponse
    {
        $userId = $request->user()->id;

        $query = MessageMention::query()->where('user_id', $userId)->whereNull('read_at');

        if (! $request->boolean('all')) {
            $query->whereIn('id', $request->validated('ids'));
        }

        $query->update(['read_at' => now()]);

        return response()->json(['unread_count' => $this->unreadCount($userId)]);
    }

    private function unreadCount(int $userId): int
    {
        return MessageMention::query()->where('user_id', $userId)->whereNull('read_at')->count();
    }
}
