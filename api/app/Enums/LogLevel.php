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

    /**
     * @return list<self>
     */
    public static function bySeverity(): array
    {
        static $ordered = null;

        if ($ordered === null) {
            $ordered = self::cases();
            usort($ordered, fn (self $a, self $b) => $a->severity() <=> $b->severity());
        }

        return $ordered;
    }

    /**
     * 1-based position of the level in an array literal ordered by severity; the literals come
     * from the enum, never from input.
     */
    public static function severitySql(string $column): string
    {
        $literals = implode(', ', array_map(fn (self $level) => "'{$level->value}'", self::bySeverity()));

        return "array_position(ARRAY[{$literals}]::text[], {$column}::text)";
    }

    public static function fromSeverityPosition(int $position): ?self
    {
        return self::bySeverity()[$position - 1] ?? null;
    }
}
