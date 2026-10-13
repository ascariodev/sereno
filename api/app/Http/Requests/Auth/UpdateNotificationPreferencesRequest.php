<?php

namespace App\Http\Requests\Auth;

use App\Enums\NotificationType;
use Illuminate\Foundation\Http\FormRequest;

class UpdateNotificationPreferencesRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'email' => ['bail', 'required', 'array', function (string $attribute, mixed $value, \Closure $fail) {
                $known = array_column(NotificationType::cases(), 'value');

                if (array_diff(array_keys($value), $known) !== []) {
                    $fail(__('The notification type is not valid.'));
                }
            }],
            'email.*' => ['boolean:strict'],
        ];
    }
}
