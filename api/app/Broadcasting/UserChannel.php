<?php

namespace App\Broadcasting;

use App\Models\User;

class UserChannel
{
    public function join(User $user, string $userId): bool
    {
        return $userId === (string) $user->id;
    }
}
