<?php

namespace App\Http\Requests\TaskComment;

use App\Models\Task;
use App\Models\TaskComment;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class UpdateTaskCommentRequest extends FormRequest
{
    /** Runs before the rules so a 422 never reveals anything to outsiders. */
    public function authorize(): bool
    {
        /** @var Task $task */
        $task = $this->route('task');
        /** @var TaskComment $comment */
        $comment = $this->route('comment');

        abort_unless($task->project_id === $this->route('project')->id && $comment->task_id === $task->id, 404);

        return Gate::authorize('update', $comment)->allowed();
    }

    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:'.TaskComment::BODY_MAX_LENGTH, 'not_regex:/\x00/'],
        ];
    }
}
