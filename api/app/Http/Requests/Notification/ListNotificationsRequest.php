<?php

namespace App\Http\Requests\Notification;

use App\Http\Requests\CursorPaginatedRequest;

class ListNotificationsRequest extends CursorPaginatedRequest
{
    public function authorize(): bool
    {
        return true;
    }
}
