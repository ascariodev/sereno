<?php

namespace App\Http\Requests\Notification;

use App\Http\Requests\Channel\ListMessagesRequest;

class ListNotificationsRequest extends ListMessagesRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_diff_key(parent::rules(), ['around' => true]);
    }
}
