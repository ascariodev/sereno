<?php

namespace App\Http\Requests\TaskComment;

use App\Models\Task;
use App\Models\TaskComment;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class DeleteTaskCommentRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var Task $task */
        $task = $this->route('task');
        /** @var TaskComment $comment */
        $comment = $this->route('comment');

        throw_unless($task->project_id === $this->route('project')->id && $comment->task_id === $task->id, ModelNotFoundException::class);

        return Gate::authorize('delete', $comment)->allowed();
    }

    public function rules(): array
    {
        return [];
    }
}
