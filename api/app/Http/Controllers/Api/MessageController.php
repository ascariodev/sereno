<?php

namespace App\Http\Controllers\Api;

use App\Events\MentionCreated;
use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\ListMessagesRequest;
use App\Http\Requests\Channel\StoreMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\MessageMention;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class MessageController extends Controller
{
    /** Relations MessageResource shows, eager loaded for lists. */
    public const RELATIONS = ['user:id,name', 'mentionedUsers:id,name', 'attachments'];

    public function index(ListMessagesRequest $request, Channel $channel): AnonymousResourceCollection
    {
        return MessageResource::collection(
            $channel->messages()
                ->whereNull('parent_id')
                ->with(self::RELATIONS)
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
                ->with(self::RELATIONS)
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage())
                ->withQueryString(),
        );
    }

    public function store(StoreMessageRequest $request, Channel $channel): MessageResource
    {
        $parentId = $request->validated('parent_id');
        $attachmentIds = $request->attachmentIds();

        $message = DB::transaction(function () use ($request, $channel, $parentId, $attachmentIds) {
            $message = new Message([
                'kind' => Message::KIND_USER,
                'body' => $request->validated('body'),
            ]);
            $message->channel()->associate($channel);
            $message->user()->associate($request->user());
            $message->parent_id = $parentId;

            // Set before save: MessageCreated resolves the resource while the model is being created.
            $mentioned = $this->mentionedUsers($channel, $message->body ?? '', $request->user()->id);
            $message->setRelation('mentionedUsers', $mentioned);
            $message->setRelation('attachments', $attachmentIds === []
                ? new Collection
                : MessageAttachment::query()->whereIn('id', $attachmentIds)->get());
            $message->save();

            $this->linkAttachments($message, $attachmentIds, $request->user()->id);

            foreach ($mentioned as $user) {
                $mention = new MessageMention;
                $mention->organization_id = $message->organization_id;
                $mention->message_id = $message->id;
                $mention->user_id = $user->id;
                $mention->save();
                MentionCreated::dispatch($user->id, $message);
            }

            if ($parentId !== null) {
                Message::query()->whereKey($parentId)->update([
                    'replies_count' => DB::raw('replies_count + 1'),
                    'last_reply_at' => DB::raw('GREATEST(last_reply_at, '.DB::getPdo()->quote($message->created_at->format('Y-m-d H:i:s')).'::timestamp)'),
                ]);
            }

            return $message;
        });

        return new MessageResource($message->load('user:id,name'));
    }

    /**
     * Takes the attachments only if they are still free: another message sent at the same time may
     * have taken them after validation, and then the whole message is rolled back.
     *
     * @param  list<int>  $ids
     */
    private function linkAttachments(Message $message, array $ids, int $authorId): void
    {
        if ($ids === []) {
            return;
        }

        $linked = MessageAttachment::query()
            ->whereIn('id', $ids)
            ->where('channel_id', $message->channel_id)
            ->where('uploaded_by', $authorId)
            ->whereNull('message_id')
            ->update(['message_id' => $message->id]);

        if ($linked !== count($ids)) {
            throw ValidationException::withMessages([
                'attachment_ids' => __('The attachments do not exist or are already in use.'),
            ]);
        }
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
