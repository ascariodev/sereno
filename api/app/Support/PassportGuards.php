<?php

namespace App\Support;

use Laravel\Passport\Passport;

class PassportGuards
{
    /**
     * Drops the Passport guards when there is no public key: building one would throw (a 500 instead of the 401).
     *
     * @param  list<string>  $guards
     * @return list<string>
     */
    public static function usable(array $guards): array
    {
        if (self::hasPublicKey()) {
            return $guards;
        }

        return array_values(array_filter($guards, fn (string $guard) => config("auth.guards.$guard.driver") !== 'passport'));
    }

    private static function hasPublicKey(): bool
    {
        return filled(config('passport.public_key')) || is_file(Passport::keyPath('oauth-public.key'));
    }
}
