<?php

namespace App\Http\Requests\TaskComment;

use App\Models\Task;
use App\Models\TaskComment;
use Closure;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

class StoreTaskCommentAttachmentRequest extends FormRequest
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
            'file' => [
                'required',
                'file',
                'max:'.config('chat.attachments.max_size_kb'),
                function (string $attribute, mixed $value, Closure $fail) {
                    if ($value instanceof UploadedFile && $value->getSize() === 0) {
                        $fail(__('The file is empty.'));
                    }
                },
            ],
        ];
    }
}
