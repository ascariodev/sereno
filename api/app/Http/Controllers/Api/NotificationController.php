<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Notification\ListNotificationsRequest;
use App\Http\Requests\Notification\MarkNotificationsReadRequest;
use App\Http\Resources\NotificationResource;
use App\Models\AppNotification;
use App\Models\User;
use App\Support\CurrentOrganization;
use App\Support\ProjectAccess;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class NotificationController extends Controller
{
    public function index(ListNotificationsRequest $request): AnonymousResourceCollection
    {
        $user = $request->user();

        return NotificationResource::collection(
            $this->accessible($user)
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage())
                ->withQueryString(),
        )->additional(['meta' => ['unread_count' => $this->unreadCount($user)]]);
    }

    public function read(MarkNotificationsReadRequest $request): JsonResponse
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
     * The user's notifications of the active organization, minus the ones of projects they cannot see (the rows stay).
     *
     * @return Builder<AppNotification>
     */
    private function accessible(User $user): Builder
    {
        $query = AppNotification::query()->where('user_id', $user->id);
        $organizationId = app(CurrentOrganization::class)->id();

        if (ProjectAccess::seesAll($user, $organizationId)) {
            return $query;
        }

        $projectIds = ProjectAccess::visibleProjectIds($user, $organizationId);

        return $query->where(fn (Builder $scope) => $scope->whereNull('project_id')->orWhereIn('project_id', $projectIds));
    }
}
