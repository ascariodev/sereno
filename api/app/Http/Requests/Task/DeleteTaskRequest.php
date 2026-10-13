<?php

namespace App\Http\Requests\Task;

use App\Models\Project;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class DeleteTaskRequest extends FormRequest
{
    public function authorize(): bool
    {
        $task = $this->route('task');

        throw_unless($task->project_id === $this->route('project')->id, ModelNotFoundException::class);

        return Gate::authorize('delete', $task)->allowed();
    }

    public function rules(): array
    {
        return [];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                /** @var Project $project */
                $project = $this->route('project');

                if ($project->isArchived()) {
                    $validator->errors()->add('project', __('This project is archived and its tasks cannot be deleted.'));
                }
            },
        ];
    }
}
