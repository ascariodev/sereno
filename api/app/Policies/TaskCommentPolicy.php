<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Comments follow the task: whoever can see the task can read and write its comments. Only the author
 * edits; the author, owners and admins delete (moderation).
 */
class TaskCommentPolicy
{
    public function viewAny(User $user, Task $task): Response|bool
    {
        return Gate::forUser($user)->inspect('view', $task);
    }

    public function view(User $user, TaskComment $comment): Response|bool
    {
        return Gate::forUser($user)->inspect('view', $comment->task);
    }

    public function create(User $user, Task $task): Response|bool
    {
        return Gate::forUser($user)->inspect('view', $task);
    }

    public function update(User $user, TaskComment $comment): Response|bool
    {
        return $this->canModify($user, $comment, moderator: false);
    }

    public function delete(User $user, TaskComment $comment): Response|bool
    {
        return $this->canModify($user, $comment, moderator: $user->hasAnyRole([Role::Owner->value, Role::Admin->value]));
    }

    private function canModify(User $user, TaskComment $comment, bool $moderator): Response|bool
    {
        $activeId = app(CurrentOrganization::class)->id();

        if ($activeId === null
            || $comment->organization_id !== $activeId
            || ($comment->user_id !== $user->id && ! $moderator)) {
            return false;
        }

        return Gate::forUser($user)->inspect('view', $comment->task);
    }
}
