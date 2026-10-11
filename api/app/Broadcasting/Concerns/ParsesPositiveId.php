<?php

namespace App\Broadcasting\Concerns;

trait ParsesPositiveId
{
    private static function positiveId(string $value): ?int
    {
        if (! ctype_digit($value)) {
            return null;
        }

        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $id === false ? null : $id;
    }
}
