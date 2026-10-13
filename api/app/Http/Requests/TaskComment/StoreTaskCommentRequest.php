<?php

namespace App\Http\Requests\TaskComment;

use App\Models\Task;
use App\Models\TaskComment;
use App\Models\TaskCommentAttachment;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class StoreTaskCommentRequest extends FormRequest
{
    /** Runs before the rules so a 422 never reveals anything to outsiders. */
    public function authorize(): bool
    {
        /** @var Task $task */
        $task = $this->route('task');

        throw_unless($task->project_id === $this->route('project')->id, ModelNotFoundException::class);

        return Gate::authorize('create', [TaskComment::class, $task])->allowed();
    }

    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:'.TaskComment::BODY_MAX_LENGTH, 'not_regex:/\x00/'],
            'attachment_ids' => ['nullable', 'list', 'max:'.config('chat.attachments.max_per_message')],
            'attachment_ids.*' => ['integer', 'min:1', 'distinct'],
        ];
    }

    public function after(): array
    {
        return [fn (Validator $validator) => $this->checkAttachments($validator)];
    }

    /** @return list<int> */
    public function attachmentIds(): array
    {
        return array_map('intval', $this->validated('attachment_ids') ?? []);
    }

    /** Ids of another user or task and ids already in use give the same error, so nothing is revealed. */
    private function checkAttachments(Validator $validator): void
    {
        $ids = $this->input('attachment_ids');

        if (! is_array($ids) || $ids === [] || $validator->errors()->has('attachment_ids*')) {
            return;
        }

        $ids = array_map('intval', $ids);

        $available = TaskCommentAttachment::query()
            ->whereIn('id', $ids)
            ->where('task_id', $this->route('task')->id)
            ->where('user_id', $this->user()->id)
            ->whereNull('task_comment_id')
            ->count();

        if ($available !== count($ids)) {
            $validator->errors()->add('attachment_ids', __('The attachments do not exist or are already in use.'));
        }
    }
}
