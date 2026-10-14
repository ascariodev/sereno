<?php

namespace App\Http\Requests\Push;

use Illuminate\Foundation\Http\FormRequest;

class DestroyPushSubscriptionRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404 here, not an `exists` rule: a 422 would tell a foreign endpoint apart from a missing one.
        $endpoint = $this->input('endpoint');

        if (! is_string($endpoint) || ! $this->user()->pushSubscriptions()->where('endpoint', $endpoint)->exists()) {
            abort(404, __('Not Found'));
        }

        return true;
    }

    public function rules(): array
    {
        return [];
    }
}
