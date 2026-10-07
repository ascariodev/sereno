<?php

namespace App\Http\Requests\LogSource;

use App\Models\LogSource;
use App\Models\Project;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class StoreLogSourceRequest extends FormRequest
{
    /** Runs before the rules so unauthorized users get 403 and never a 422 about the project state. */
    public function authorize(): bool
    {
        return Gate::allows('create', LogSource::class);
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                $project = $this->route('project');

                $error = $project instanceof Project ? $project->logSourceCreationError() : null;

                if ($error !== null) {
                    $validator->errors()->add('project', $error);
                }
            },
        ];
    }
}
