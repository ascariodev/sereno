<?php

namespace App\Http\Requests\LogSource;

use App\Models\LogSource;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Validator;

class RotateLogSourceKeyRequest extends FormRequest
{
    /** Runs before the checks so unauthorized users get 404/403 and never a 422 about the source state. */
    public function authorize(): bool
    {
        $source = $this->route('source');

        throw_unless($source instanceof LogSource && $source->project_id === $this->route('project')?->id, ModelNotFoundException::class);

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
