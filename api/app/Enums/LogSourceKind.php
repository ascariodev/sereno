<?php

namespace App\Enums;

enum LogSourceKind: string
{
    case Server = 'server';
    case Browser = 'browser';

    public function keyPrefix(): string
    {
        return match ($this) {
            self::Server => 'wsk_',
            self::Browser => 'wsp_',
        };
    }
}
