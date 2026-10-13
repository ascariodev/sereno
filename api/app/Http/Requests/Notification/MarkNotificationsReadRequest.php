<?php

namespace App\Http\Requests\Notification;

use Illuminate\Foundation\Http\FormRequest;

class MarkNotificationsReadRequest extends FormRequest
{
    public const MAX_IDS = 100;

    public function authorize(): bool
    {
        return true;
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
