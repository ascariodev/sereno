<?php

namespace App\Http\Requests\TaskComment;

use App\Models\Task;
use App\Models\TaskComment;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class UpdateTaskCommentRequest extends FormRequest
{
    /** Runs before the rules so a 422 never reveals anything to outsiders. */
    public function authorize(): bool
    {
        /** @var Task $task */
        $task = $this->route('task');
        /** @var TaskComment $comment */
        $comment = $this->route('comment');

        throw_unless($task->project_id === $this->route('project')->id && $comment->task_id === $task->id, ModelNotFoundException::class);

        return Gate::authorize('update', $comment)->allowed();
    }

    public function rules(): array
    {
        return [
            'remove_attachment_ids' => ['sometimes', 'list', 'max:'.config('chat.attachments.max_per_message')],
            'remove_attachment_ids.*' => ['integer', 'distinct', Rule::exists('task_comment_attachments', 'id')->where('task_comment_id', $this->route('comment')->id)],
            'body' => ['required', 'string', 'max:'.TaskComment::BODY_MAX_LENGTH, 'not_regex:/\x00/'],
        ];
    }

    /** @return list<int> */
    public function removeAttachmentIds(): array
    {
        return array_map('intval', $this->validated('remove_attachment_ids') ?? []);
    }
}
