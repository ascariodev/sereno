<?php

namespace App\Enums;

enum LogLevel: string
{
    case Debug = 'debug';
    case Info = 'info';
    case Notice = 'notice';
    case Warning = 'warning';
    case Error = 'error';
    case Critical = 'critical';
    case Alert = 'alert';
    case Emergency = 'emergency';

    public function severity(): int
    {
        return match ($this) {
            self::Debug => 0,
            self::Info => 1,
            self::Notice => 2,
            self::Warning => 3,
            self::Error => 4,
            self::Critical => 5,
            self::Alert => 6,
            self::Emergency => 7,
        };
    }

    public function isAtLeast(self $other): bool
    {
        return $this->severity() >= $other->severity();
    }

    public static function highest(self $first, self $second): self
    {
        return $second->severity() > $first->severity() ? $second : $first;
    }
}
