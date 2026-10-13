<?php

namespace App\Http\Requests\Push;

use Illuminate\Foundation\Http\FormRequest;

class StorePushSubscriptionRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'endpoint' => ['required', 'string', 'url:https', 'max:2048'],
            'public_key' => ['required', 'string', 'max:255'],
            'auth_token' => ['required', 'string', 'max:255'],
            'content_encoding' => ['sometimes', 'string', 'in:aes128gcm,aesgcm'],
            'user_agent' => ['nullable', 'string', 'max:512'],
        ];
    }
}
