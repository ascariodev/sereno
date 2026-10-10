<?php

namespace App\Http\Requests\Task;

use App\Models\Project;
use App\Models\Task;
use App\Support\CurrentOrganization;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateTaskRequest extends FormRequest
{
    /** Runs before the rules so a 422 never reveals members to outsiders. */
    public function authorize(): bool
    {
        return Gate::allows('update', $this->route('task'));
    }

    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'required', 'string', 'max:'.Task::TITLE_MAX_LENGTH, 'not_regex:/\x00/'],
            'description' => ['sometimes', 'nullable', 'string', 'max:'.StoreTaskRequest::DESCRIPTION_MAX_LENGTH, 'not_regex:/\x00/'],
            'assignee_id' => [
                'sometimes',
                'nullable',
                'integer',
                Rule::exists('organization_user', 'user_id')
                    ->where('organization_id', app(CurrentOrganization::class)->id()),
            ],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                /** @var Project $project */
                $project = $this->route('project');

                if ($project->isArchived()) {
                    $validator->errors()->add('project', __('This project is archived and its tasks cannot be edited.'));
                }
            },
        ];
    }
}
