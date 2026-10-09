<?php

namespace App\Chat;

use App\Events\MentionCreated;
use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageMention;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class MessageMentions
{
    /**
     * Members of the channel's organization named by `<@id>` tokens, minus the author, ordered by id. Only
     * the first `chat.mentions.max_per_message` of them (in order of appearance) count; the body keeps all.
     *
     * @return Collection<int, User>
     */
    public function target(Channel $channel, ?string $body, int $authorId): Collection
    {
        preg_match_all('/<@([1-9][0-9]{0,17})>/', $body ?? '', $matches);
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

    /**
     * Mentions to add (users in the target without a row) and to remove (user ids with a row but not in the target).
     *
     * @param  Collection<int, User>  $target
     * @param  list<int>  $currentIds  user ids of the existing mention rows
     * @return array{added: Collection<int, User>, removed: list<int>}
     */
    public function diff(Collection $target, array $currentIds): array
    {
        return [
            'added' => $target->reject(fn (User $user) => in_array($user->id, $currentIds, true))->values(),
            'removed' => array_values(array_diff($currentIds, $target->pluck('id')->all())),
        ];
    }

    /**
     * Brings the message's mention rows to the target: inserts the new ones (dispatching MentionCreated for
     * each) and deletes the ones no longer mentioned. Pass `$currentIds` to skip the lookup (new message: []).
     *
     * @param  Collection<int, User>  $target
     * @param  list<int>|null  $currentIds
     * @return array{added: Collection<int, User>, removed: list<int>}
     */
    public function sync(Message $message, Collection $target, ?array $currentIds = null): array
    {
        $currentIds ??= MessageMention::query()
            ->where('message_id', $message->id)
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $changes = $this->diff($target, $currentIds);

        if ($changes['removed'] !== []) {
            MessageMention::query()
                ->where('message_id', $message->id)
                ->whereIn('user_id', $changes['removed'])
                ->delete();
        }

        if ($changes['added']->isNotEmpty()) {
            $now = now();
            MessageMention::query()->insert($changes['added']->map(fn (User $user) => [
                'organization_id' => $message->organization_id,
                'message_id' => $message->id,
                'user_id' => $user->id,
                'created_at' => $now,
            ])->all());

            foreach ($changes['added'] as $user) {
                MentionCreated::dispatch($user->id, $message);
            }
        }

        return $changes;
    }
}
