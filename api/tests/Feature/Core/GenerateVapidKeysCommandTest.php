<?php

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Artisan;

function vapidKeysFromOutput(string $output): array
{
    preg_match('/^VAPID_PUBLIC_KEY=(\S*)$/m', $output, $public);
    preg_match('/^VAPID_PRIVATE_KEY=(\S*)$/m', $output, $private);

    return [$public[1] ?? '', $private[1] ?? ''];
}

function decodeBase64Url(string $value): string|false
{
    if (! preg_match('/^[A-Za-z0-9_-]+$/', $value)) {
        return false;
    }

    return base64_decode(strtr($value, '-_', '+/'), true);
}

it('prints a valid VAPID key pair in base64url', function () {
    expect(Artisan::call('push:vapid-keys'))->toBe(0);

    [$public, $private] = vapidKeysFromOutput(Artisan::output());

    $publicBytes = decodeBase64Url($public);
    $privateBytes = decodeBase64Url($private);

    expect($publicBytes)->not->toBeFalse()
        ->and(strlen($publicBytes))->toBe(65)
        ->and($publicBytes[0])->toBe("\x04")
        ->and($privateBytes)->not->toBeFalse()
        ->and(strlen($privateBytes))->toBe(32);
});

it('prints a different key pair on each run', function () {
    Artisan::call('push:vapid-keys');
    $first = vapidKeysFromOutput(Artisan::output());

    Artisan::call('push:vapid-keys');
    $second = vapidKeysFromOutput(Artisan::output());

    expect($first[1])->not->toBe('')
        ->and($first[1])->not->toBe($second[1]);
});

it('reads the VAPID settings from the environment', function () {
    $env = [
        'VAPID_PUBLIC_KEY' => 'public-key',
        'VAPID_PRIVATE_KEY' => 'private-key',
        'VAPID_SUBJECT' => 'mailto:push@sereno.test',
    ];

    $previous = [];

    foreach ($env as $name => $value) {
        $previous[$name] = [getenv($name), $_ENV[$name] ?? null, $_SERVER[$name] ?? null];
        putenv("{$name}={$value}");
        $_ENV[$name] = $_SERVER[$name] = $value;
    }

    try {
        $config = require config_path('workspace.php');
    } finally {
        foreach ($previous as $name => [$putenv, $envValue, $serverValue]) {
            putenv($putenv === false ? $name : "{$name}={$putenv}");
            $envValue === null ? Arr::forget($_ENV, $name) : $_ENV[$name] = $envValue;
            $serverValue === null ? Arr::forget($_SERVER, $name) : $_SERVER[$name] = $serverValue;
        }
    }

    expect($config['push'])->toBe([
        'vapid_public_key' => 'public-key',
        'vapid_private_key' => 'private-key',
        'vapid_subject' => 'mailto:push@sereno.test',
    ]);
});
