<?php

namespace App\Support;

use App\Http\Requests\Task\StoreTaskRequest;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Row locks the task writes (create, move, update) take inside their transaction to re-check what the request
 * validated before it. Callers take lockAssigneeAccess before lockActiveProject.
 */
class TaskLocks
{
    /**
     * Locks the project row and re-checks, now that archiving cannot interleave, that it is still active: the request
     * validated it before the transaction. NO KEY keeps inserts that reference the project free.
     */
    public static function lockActiveProject(Project $project, string $archivedMessage): object
    {
        $row = DB::table('projects')
            ->where('id', $project->id)
            ->lock('for no key update')
            ->first(['archived_at', 'tasks_resolve_log_groups']);

        if ($row === null || $row->archived_at !== null) {
            throw ValidationException::withMessages(['project' => $archivedMessage]);
        }

        return $row;
    }

    /**
     * Re-checks the assignee's access after the request validated it. FOR SHARE on the organization row waits for the
     * FOR UPDATE that access and membership changes hold until commit, and blocks them until this commit, so nobody is
     * assigned while losing access. It is taken first, before projects and tasks, like those changes do (organization,
     * then project_user and tasks), so no lock cycle; assignments do not block each other or inserts that reference
     * the organization.
     */
    public static function lockAssigneeAccess(Project $project, ?int $assigneeId): void
    {
        if ($assigneeId === null) {
            return;
        }

        DB::table('organizations')->where('id', $project->organization_id)->sharedLock()->first();

        $assignee = User::query()->find($assigneeId);

        if ($assignee === null || ! ProjectAccess::canView($assignee, $project)) {
            throw ValidationException::withMessages([
                'assignee_id' => StoreTaskRequest::assigneeWithoutAccessMessage(),
            ]);
        }
    }
}
