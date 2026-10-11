<?php

namespace App\Broadcasting;

use App\Models\User;

class SessionChannel
{
    public function join(User $user, string $userId): array|false
    {
        return $userId === (string) $user->id ? ['id' => $user->id] : false;
    }
}
