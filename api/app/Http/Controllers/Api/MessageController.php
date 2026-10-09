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

    /** Distinct reply authors shown as avatars in the thread summary. */
    public const PARTICIPANTS = 3;

    public function index(ListMessagesRequest $request, Channel $channel): AnonymousResourceCollection
    {
        $page = $channel->messages()
            ->whereNull('parent_id')
            ->with(self::RELATIONS)
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        $this->loadParticipants($page->items());

        return MessageResource::collection($page);
    }

    /**
     * Sets the `recentParticipants` relation (latest distinct reply authors, newest first) on the
     * roots with replies, in two queries. The messages query is tenant scoped.
     *
     * @param  array<int, Message>  $roots
     */
    private function loadParticipants(array $roots): void
    {
        $withReplies = collect($roots)->filter(fn (Message $root) => $root->replies_count > 0);
        if ($withReplies->isEmpty()) {
            return;
        }

        $authors = Message::query()
            ->whereIn('parent_id', $withReplies->pluck('id'))
            ->whereNotNull('user_id')
            ->groupBy('parent_id', 'user_id')
            ->selectRaw('parent_id, user_id, max(id) as last_id')
            ->get()
            ->groupBy('parent_id')
            ->map(fn ($rows) => $rows->sortByDesc('last_id')->take(self::PARTICIPANTS)->pluck('user_id'));

        $users = User::query()->whereIn('id', $authors->flatten()->unique())->get(['id', 'name'])->keyBy('id');

        foreach ($withReplies as $root) {
            $root->setRelation('recentParticipants', ($authors[$root->id] ?? collect())
                ->map(fn ($id) => $users[$id])->values());
        }
    }

    public function replies(ListMessagesRequest $request, Channel $channel, Message $message): AnonymousResourceCollection
    {
        abort_unless($message->channel_id === $channel->id && $message->parent_id === null, 404);

        $page = $channel->messages()
            ->where('parent_id', $message->id)
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        // The root rides along in meta.root (threads opened outside the loaded channel page);
        // loading it together with the replies keeps one query per relation.
        (new Collection([...$page->items(), $message]))->load(self::RELATIONS);
        $this->loadParticipants([$message]);

        return MessageResource::collection($page)
            ->additional(['meta' => ['root' => (new MessageResource($message))->resolve($request)]]);
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

            $this->saveMentions($message, $mentioned);

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

        // The UPDATE locks rows in scan order; locking them by id first keeps two sends with the
        // same ids from waiting on each other in reverse order. Only the author's own rows are locked.
        MessageAttachment::query()
            ->whereIn('id', $ids)
            ->where('channel_id', $message->channel_id)
            ->where('uploaded_by', $authorId)
            ->orderBy('id')
            ->lockForUpdate()
            ->pluck('id');

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

    /** @param  Collection<int, User>  $mentioned */
    private function saveMentions(Message $message, Collection $mentioned): void
    {
        if ($mentioned->isEmpty()) {
            return;
        }

        $now = now();
        MessageMention::query()->insert($mentioned->map(fn (User $user) => [
            'organization_id' => $message->organization_id,
            'message_id' => $message->id,
            'user_id' => $user->id,
            'created_at' => $now,
        ])->all());

        foreach ($mentioned as $user) {
            MentionCreated::dispatch($user->id, $message);
        }
    }

    /**
     * Members of the channel's organization named by `<@id>` tokens, minus the author, ordered by id. Only
     * the first `chat.mentions.max_per_message` of them (in order of appearance) count; the body keeps all.
     *
     * @return Collection<int, User>
     */
    private function mentionedUsers(Channel $channel, string $body, int $authorId): Collection
    {
        preg_match_all('/<@([1-9][0-9]{0,17})>/', $body, $matches);
        $ids = array_values(array_diff(array_unique(array_map('intval', $matches[1])), [$authorId]));

        if ($ids === []) {
            return new Collection;
        }

        $members = User::query()
            ->whereIn('id', $ids)
            ->whereIn('id', DB::table('organization_user')->where('organization_id', $channel->organization_id)->select('user_id'))
            ->get(['id', 'name'])
            ->keyBy('id');

        return (new Collection(array_map(fn (int $id) => $members->get($id), $ids)))
            ->filter()
            ->take(config('chat.mentions.max_per_message'))
            ->sortBy('id')
            ->values();
    }
}
