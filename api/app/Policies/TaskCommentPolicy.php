<?php

namespace App\Policies;

use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\Gate;

/** Comments follow the task: whoever can see the task can read and write its comments. */
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
}
