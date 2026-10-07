<?php

namespace App\Http\Requests\LogSource;

use App\Models\LogSource;
use App\Models\Project;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class RotateLogSourceKeyRequest extends FormRequest
{
    /** Runs before the checks so unauthorized users get 404/403 and never a 422 about the source state. */
    public function authorize(): bool
    {
        $source = $this->route('source');

        abort_unless($source instanceof LogSource && $source->project_id === $this->route('project')?->id, 404);

        return Gate::allows('rotateKey', $source);
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
                    $validator->errors()->add('project', __('This project is archived and its log source keys cannot be rotated.'));
                }

                if ($this->route('source')->isRevoked()) {
                    $validator->errors()->add('source', __('This log source is revoked and its key cannot be rotated.'));
                }
            },
        ];
    }
}
