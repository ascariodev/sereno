<?php

namespace App\Http\Requests\LogSource;

use App\Models\LogSource;
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
                foreach ($this->route('source')->rotationErrors($this->route('project')) as $field => $message) {
                    $validator->errors()->add($field, $message);
                }
            },
        ];
    }
}
