<?php

namespace App\Http\Requests\Task;

use App\Models\Project;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class DeleteTaskRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('delete', $this->route('task'));
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
