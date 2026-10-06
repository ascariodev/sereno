<?php

namespace App\Enums;

enum Locale: string
{
    case En = 'en';
    case Es = 'es';

    public static function default(): self
    {
        return self::En;
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
