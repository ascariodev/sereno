<?php

namespace App\Http\Requests\Task;

use App\Enums\TaskStatus;
use App\Models\Project;
use App\Models\Task;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * `after_id` is the task that ends up right above the moved one and `before_id` the one right below it. Whether
 * they are in the target column is checked by the controller with the column locked.
 */
class MoveTaskRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('update', $this->route('task'));
    }

    public function rules(): array
    {
        /** @var Task $task */
        $task = $this->route('task');

        return [
            'status' => ['required', Rule::enum(TaskStatus::class)],
            'before_id' => ['nullable', 'integer', 'min:1', Rule::notIn([$task->id]), 'different:after_id'],
            'after_id' => ['nullable', 'integer', 'min:1', Rule::notIn([$task->id])],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                /** @var Project $project */
                $project = $this->route('project');

                if ($project->isArchived()) {
                    $validator->errors()->add('project', __('This project is archived and its tasks cannot be moved.'));
                }
            },
        ];
    }

    public function taskStatus(): TaskStatus
    {
        return TaskStatus::from((string) $this->validated('status'));
    }

    public function beforeId(): ?int
    {
        return $this->validated('before_id') === null ? null : (int) $this->validated('before_id');
    }

    public function afterId(): ?int
    {
        return $this->validated('after_id') === null ? null : (int) $this->validated('after_id');
    }
}
