<?php

namespace App\Http\Requests\LogGroup;

use App\Models\LogGroup;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class HourlyLogGroupsRequest extends FormRequest
{
    public const MAX_IDS = 100;

    public function authorize(): bool
    {
        return Gate::allows('viewAny', LogGroup::class);
    }

    protected function prepareForValidation(): void
    {
        $ids = $this->query('ids');

        if (is_string($ids)) {
            $this->merge(['ids' => explode(',', $ids)]);
        }
    }

    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:'.self::MAX_IDS],
            'ids.*' => ['required', 'integer', 'min:1'],
        ];
    }

    /** @return list<int> */
    public function ids(): array
    {
        return array_values(array_unique(array_map('intval', $this->validated('ids'))));
    }
}
