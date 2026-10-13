<?php

namespace App\Http\Requests\Push;

use Illuminate\Foundation\Http\FormRequest;

class DestroyPushSubscriptionRequest extends FormRequest
{
    public function authorize(): bool
    {
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
