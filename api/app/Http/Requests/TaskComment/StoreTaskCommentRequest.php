<?php

namespace App\Http\Requests\TaskComment;

use App\Models\Task;
use App\Models\TaskComment;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class StoreTaskCommentRequest extends FormRequest
{
    /** Runs before the rules so a 422 never reveals anything to outsiders. */
    public function authorize(): bool
    {
        /** @var Task $task */
        $task = $this->route('task');
        abort_unless($task->project_id === $this->route('project')->id, 404);

        return Gate::authorize('create', [TaskComment::class, $task])->allowed();
    }

    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:'.TaskComment::BODY_MAX_LENGTH, 'not_regex:/\x00/'],
        ];
    }
}
