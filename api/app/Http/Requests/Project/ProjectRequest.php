<?php

namespace App\Http\Requests\Project;

use App\Models\Project;
use App\Support\CurrentOrganization;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class ProjectRequest extends FormRequest
{
    /**
     * Runs before the rules: the key uniqueness check queries the organization's data,
     * so unauthorized users must get 403 and never a 422 that leaks which keys exist.
     */
    public function authorize(): bool
    {
        $project = $this->route('project');

        return $project instanceof Project
            ? Gate::allows('update', $project)
            : Gate::allows('create', Project::class);
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('key'))) {
            $this->merge(['key' => strtoupper(trim($this->input('key')))]);
        }
    }

    public function rules(): array
    {
        $project = $this->route('project');
        $required = $project instanceof Project ? 'sometimes' : 'required';

        return [
            'name' => [$required, 'string', 'max:255'],
            'key' => [
                $required, 'string', 'regex:/^[A-Z][A-Z0-9]{1,9}$/',
                Rule::unique('projects', 'key')
                    ->where('organization_id', app(CurrentOrganization::class)->id())
                    ->ignore($project instanceof Project ? $project->id : null),
            ],
            'description' => ['nullable', 'string', 'max:5000'],
        ];
    }

    public function messages(): array
    {
        return [
            'key.unique' => __('A project with this key already exists in the organization.'),
        ];
    }
}
