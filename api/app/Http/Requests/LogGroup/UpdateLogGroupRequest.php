<?php

namespace App\Http\Requests\LogGroup;

use App\Enums\LogGroupStatus;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class UpdateLogGroupRequest extends FormRequest
{
    public function authorize(): bool
    {
        $group = $this->route('group');

        throw_unless($group->project_id === $this->route('project')->id, ModelNotFoundException::class);

        return Gate::authorize('update', $group)->allowed();
    }

    public function rules(): array
    {
        return [
            'status' => ['required', Rule::enum(LogGroupStatus::class)],
        ];
    }
}
