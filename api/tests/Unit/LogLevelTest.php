<?php

use App\Enums\LogLevel;

it('orders every case by ascending severity', function () {
    $ordered = LogLevel::bySeverity();

    expect($ordered)->toHaveCount(count(LogLevel::cases()))
        ->and(array_map(fn (LogLevel $level) => $level->severity(), $ordered))->toBe(range(0, count($ordered) - 1));
});

it('maps every 1-based severity position back to its level', function () {
    expect(LogLevel::cases())->not->toBeEmpty();

    foreach (LogLevel::cases() as $level) {
        expect(LogLevel::fromSeverityPosition($level->severity() + 1))->toBe($level);
    }
});

it('returns null for positions outside the enum', function () {
    expect(LogLevel::fromSeverityPosition(0))->toBeNull()
        ->and(LogLevel::fromSeverityPosition(count(LogLevel::cases()) + 1))->toBeNull();
});
