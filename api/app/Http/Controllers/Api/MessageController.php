<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\ListMessagesRequest;
use App\Http\Requests\Channel\StoreMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageMention;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

class MessageController extends Controller
{
    public function index(ListMessagesRequest $request, Channel $channel): AnonymousResourceCollection
    {
        return MessageResource::collection(
            $channel->messages()
                ->whereNull('parent_id')
                ->with(['user:id,name', 'mentionedUsers:id,name'])
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
                ->with(['user:id,name', 'mentionedUsers:id,name'])
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

            // Set before save: MessageCreated resolves the resource while the model is being created.
            $mentioned = $this->mentionedUsers($channel, $message->body, $request->user()->id);
            $message->setRelation('mentionedUsers', $mentioned);
            $message->save();

            foreach ($mentioned as $user) {
                $mention = new MessageMention;
                $mention->organization_id = $message->organization_id;
                $mention->message_id = $message->id;
                $mention->user_id = $user->id;
                $mention->save();
            }

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

    /** @return Collection<int, User> members of the channel's organization named by `<@id>` tokens, minus the author */
    private function mentionedUsers(Channel $channel, string $body, int $authorId): Collection
    {
        preg_match_all('/<@([1-9][0-9]{0,17})>/', $body, $matches);
        $ids = array_values(array_diff(array_unique(array_map('intval', $matches[1])), [$authorId]));

        if ($ids === []) {
            return new Collection;
        }

        return User::query()
            ->whereIn('id', $ids)
            ->whereIn('id', DB::table('organization_user')->where('organization_id', $channel->organization_id)->select('user_id'))
            ->orderBy('id')
            ->get(['id', 'name']);
    }
}
