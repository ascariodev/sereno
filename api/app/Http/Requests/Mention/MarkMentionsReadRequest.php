<?php

namespace App\Http\Requests\Mention;

use App\Models\Channel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class MarkMentionsReadRequest extends FormRequest
{
    public const MAX_IDS = 100;

    public function authorize(): bool
    {
        return Gate::allows('viewAny', Channel::class);
    }

    public function rules(): array
    {
        return [
            'all' => ['sometimes', 'boolean'],
            'ids' => ['required_unless:all,true,1', 'array', 'max:'.self::MAX_IDS],
            'ids.*' => ['integer', 'min:1'],
        ];
    }
}
