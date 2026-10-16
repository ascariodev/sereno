<?php

namespace App\Http\Requests\OAuth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ApproveAuthorizationRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            // Same error for an organization the user is not in and one that does not exist.
            'organization_id' => [
                'required',
                'integer',
                Rule::exists('organization_user', 'organization_id')->where('user_id', $this->user()->getKey()),
            ],
        ];
    }
}
