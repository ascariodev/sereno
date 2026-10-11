<?php

namespace App\Http\Requests\Task;

use App\Enums\TaskStatus;
use App\Models\LogGroup;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use App\Support\ProjectAccess;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreTaskRequest extends FormRequest
{
    /** Runs before the rules so a 422 never reveals members or log groups to outsiders. */
    public function authorize(): bool
    {
        return Gate::allows('create', Task::class)
            && Gate::authorize('view', $this->route('project'))->allowed();
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:'.Task::TITLE_MAX_LENGTH, 'not_regex:/\x00/'],
            'description' => ['nullable', 'string', 'max:'.Task::DESCRIPTION_MAX_LENGTH, 'not_regex:/\x00/'],
            'status' => ['nullable', Rule::enum(TaskStatus::class)],
            'assignee_id' => [
                'nullable',
                'integer',
                Rule::exists('organization_user', 'user_id')
                    ->where('organization_id', app(CurrentOrganization::class)->id()),
            ],
            'log_group_id' => ['nullable', 'integer', 'min:1'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                /** @var Project $project */
                $project = $this->route('project');

                if ($project->isArchived()) {
                    $validator->errors()->add('project', __('This project is archived and cannot have new tasks.'));
                }

                self::validateAssigneeAccess($validator, $project, $this->input('assignee_id'));

                if ($validator->errors()->has('log_group_id') || $this->input('log_group_id') === null) {
                    return;
                }

                $groupId = $this->integer('log_group_id');

                // The organization scope hides groups of other organizations.
                $inProject = LogGroup::query()->whereKey($groupId)->where('project_id', $project->id)->exists();

                if (! $inProject) {
                    $validator->errors()->add('log_group_id', __('The log group does not exist in this project.'));
                } elseif (Task::query()->where('log_group_id', $groupId)->exists()) {
                    $validator->errors()->add('log_group_id', __('The log group already has a task.'));
                }
            },
        ];
    }

    public static function validateAssigneeAccess(Validator $validator, Project $project, mixed $assigneeId): void
    {
        if ($assigneeId === null || $validator->errors()->has('assignee_id')) {
            return;
        }

        $assignee = User::query()->find((int) $assigneeId);

        if ($assignee === null || ! ProjectAccess::canView($assignee, $project)) {
            $validator->errors()->add('assignee_id', self::assigneeWithoutAccessMessage());
        }
    }

    public static function assigneeWithoutAccessMessage(): string
    {
        return __('The selected assignee does not have access to this project.');
    }

    public function taskStatus(): TaskStatus
    {
        return TaskStatus::tryFrom((string) $this->validated('status')) ?? TaskStatus::Todo;
    }
}
