<?php

namespace App\Http\Requests\Push;

use Illuminate\Foundation\Http\FormRequest;

class DestroyExpoPushTokenRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404 here, not an `exists` rule: a 422 would tell a foreign token apart from a missing one.
        $token = $this->input('token');

        if (! is_string($token) || ! $this->user()->expoPushTokens()->where('token', $token)->exists()) {
            abort(404, __('Not Found'));
        }

        return true;
    }

    public function rules(): array
    {
        return [];
    }
}
