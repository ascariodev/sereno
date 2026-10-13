<?php

namespace App\Listeners;

use App\Events\MembershipRevoked;
use App\Events\MembershipRoleChanged;
use App\Events\ProjectAccessChanged;
use App\Models\AppNotification;
use App\Models\User;
use App\Support\ProjectAccess;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Synchronous, after the commit: reads the current access, not the payload. A failure is reported and swallowed so it
 * neither fails a committed change nor skips the later after-commit callbacks (TerminateUserConnections).
 */
class PruneInaccessibleNotifications
{
    public function handleMembershipRevoked(MembershipRevoked $event): void
    {
        $this->prune($event->userId, $event->organizationId);
    }

    public function handleMembershipRoleChanged(MembershipRoleChanged $event): void
    {
        $this->prune($event->userId, $event->organizationId);
    }

    public function handleProjectAccessChanged(ProjectAccessChanged $event): void
    {
        $this->prune($event->userId, $event->organizationId);
    }

    private function prune(int $userId, int $organizationId): void
    {
        try {
            $this->deleteUnseen($userId, $organizationId);
        } catch (Throwable $e) {
            report($e);
        }
    }

    private function deleteUnseen(int $userId, int $organizationId): void
    {
        $query = AppNotification::query()
            ->withoutGlobalScopes()
            ->where('user_id', $userId)
            ->where('organization_id', $organizationId);

        $user = User::query()->find($userId);

        $isMember = $user !== null && DB::table('organization_user')
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->exists();

        if (! $isMember) {
            $query->delete();

            return;
        }

        if (ProjectAccess::seesAll($user, $organizationId)) {
            return;
        }

        $query->whereNotNull('project_id')
            ->whereNotIn('project_id', ProjectAccess::visibleProjectIds($user, $organizationId))
            ->delete();
    }
}
