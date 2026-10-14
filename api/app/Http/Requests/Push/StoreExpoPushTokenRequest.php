<?php

namespace App\Http\Requests\Push;

use Illuminate\Foundation\Http\FormRequest;

class StoreExpoPushTokenRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'token' => ['required', 'string', 'max:255', 'regex:/^(Exponent|Expo)PushToken\[[^\]\s]+\]$/'],
            'platform' => ['required', 'string', 'in:android,ios'],
            'device_name' => ['nullable', 'string', 'max:255'],
        ];
    }
}
