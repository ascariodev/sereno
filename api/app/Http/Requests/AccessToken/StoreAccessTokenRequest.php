<?php

namespace App\Http\Requests\AccessToken;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreAccessTokenRequest extends FormRequest
{
    public const EXPIRATION_DAYS = [30, 90, 365];

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'expires_in_days' => ['nullable', 'integer', Rule::in(self::EXPIRATION_DAYS)],
        ];
    }
}
