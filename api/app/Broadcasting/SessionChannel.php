<?php

namespace App\Broadcasting;

use App\Models\User;

class SessionChannel
{
    /**
     * @return array{id: int}|false
     */
    public function join(User $user, string $userId): array|false
    {
        return $userId === (string) $user->id ? ['id' => $user->id] : false;
    }
}
