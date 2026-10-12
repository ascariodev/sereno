<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class MentionTargets
{
    /**
     * Members of the organization named by `<@id>` tokens in the body, minus the author, ordered by id. With a
     * project, only those who can view it. Only the first `$max` of them (in order of appearance) count.
     * Access is resolved in a batch, not per mentioned id.
     *
     * @return Collection<int, User>
     */
    public static function resolve(?string $body, int $authorId, int $organizationId, ?int $projectId, int $max): Collection
    {
        preg_match_all('/<@([1-9][0-9]{0,17})>/', $body ?? '', $matches);
        $ids = array_values(array_diff(array_unique(array_map('intval', $matches[1])), [$authorId]));

        if ($ids === []) {
            return new Collection;
        }

        $members = User::query()
            ->whereIn('id', $ids)
            ->whereIn('id', DB::table('organization_user')->where('organization_id', $organizationId)->select('user_id'))
            ->get(['id', 'name'])
            ->keyBy('id');

        $memberIds = array_values(array_filter($ids, fn (int $id) => $members->has($id)));

        if ($projectId !== null) {
            $memberIds = ProjectAccess::viewableUserIds($memberIds, $organizationId, $projectId);
        }

        $mentioned = array_map(
            fn (int $id) => $members->get($id),
            array_slice($memberIds, 0, $max),
        );

        return (new Collection($mentioned))->sortBy('id')->values();
    }
}
