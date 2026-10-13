<?php

namespace App\Http\Requests\Auth;

use App\Enums\NotificationType;
use Illuminate\Foundation\Http\FormRequest;

class UpdateNotificationPreferencesRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'email' => ['bail', 'required_without:push', 'array', $this->knownTypes(...)],
            'email.*' => ['boolean:strict'],
            'push' => ['bail', 'required_without:email', 'array', $this->knownTypes(...)],
            'push.*' => ['boolean:strict'],
        ];
    }

    private function knownTypes(string $attribute, mixed $value, \Closure $fail): void
    {
        $known = array_column(NotificationType::cases(), 'value');

        if (array_diff(array_keys($value), $known) !== []) {
            $fail(__('The notification type is not valid.'));
        }
    }
}
