<?php

namespace App\Http\Requests\LogGroup;

use App\Enums\LogGroupStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class UpdateLogGroupRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Gate::allows('update', $this->route('group'));
    }

    public function rules(): array
    {
        return [
            'status' => ['required', Rule::enum(LogGroupStatus::class)],
        ];
    }
}
