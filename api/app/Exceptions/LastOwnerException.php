<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

class LastOwnerException extends RuntimeException
{
    public const MESSAGE = 'The organization must keep at least one owner.';

    public function __construct()
    {
        parent::__construct(self::MESSAGE);
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => __(self::MESSAGE)], 422);
    }
}
