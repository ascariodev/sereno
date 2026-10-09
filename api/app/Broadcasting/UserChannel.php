<?php

namespace App\Broadcasting;

use App\Models\User;

class UserChannel
{
    public function join(User $user, string $userId): bool
    {
        if (! ctype_digit($userId)) {
            return false;
        }

        $parsed = filter_var($userId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $parsed !== false && $parsed === $user->id && (string) $parsed === $userId;
    }
}
