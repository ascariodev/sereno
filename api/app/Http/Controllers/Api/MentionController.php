<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Mention\ListMentionsRequest;
use App\Http\Requests\Mention\MarkMentionsReadRequest;
use App\Http\Resources\MentionResource;
use App\Models\MessageMention;
use App\Models\User;
use App\Support\CurrentOrganization;
use App\Support\ProjectAccess;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MentionController extends Controller
{
    public function index(ListMentionsRequest $request): AnonymousResourceCollection
    {
        $user = $request->user();

        return MentionResource::collection(
            $this->accessible($user)
                ->with(['message.user:id,name', 'message.mentionedUsers:id,name', 'message.attachments', 'message.channel:id,name,project_id'])
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage())
                ->withQueryString(),
        )->additional(['meta' => ['unread_count' => $this->unreadCount($user)]]);
    }

    public function read(MarkMentionsReadRequest $request): JsonResponse
    {
        $user = $request->user();

        $query = $this->accessible($user)->whereNull('read_at');

        if (! $request->boolean('all')) {
            $query->whereIn('id', $request->validated('ids'));
        }

        $query->update(['read_at' => now()]);

        return response()->json(['unread_count' => $this->unreadCount($user)]);
    }

    private function unreadCount(User $user): int
    {
        return $this->accessible($user)->whereNull('read_at')->count();
    }

    /**
     * The user's mentions, minus the ones in channels of projects they cannot see (the rows stay).
     *
     * @return Builder<MessageMention>
     */
    private function accessible(User $user): Builder
    {
        $query = MessageMention::query()->where('user_id', $user->id);
        $organizationId = app(CurrentOrganization::class)->id();

        if (ProjectAccess::seesAll($user, $organizationId)) {
            return $query;
        }

        $projectIds = ProjectAccess::visibleProjectIds($user, $organizationId);

        return $query->whereHas('message.channel', fn (Builder $channel) => $channel->where(fn (Builder $scope) => $scope
            ->whereNull('project_id')
            ->orWhereIn('project_id', $projectIds)));
    }
}
