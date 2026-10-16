<?php

namespace App\Http\Middleware;

use App\Support\PassportGuards;
use Illuminate\Auth\Middleware\Authenticate;

class AuthenticateMcp extends Authenticate
{
    /**
     * @param  array<int, string>  $guards
     */
    protected function authenticate($request, array $guards): void
    {
        parent::authenticate($request, PassportGuards::usable($guards));
    }
}
