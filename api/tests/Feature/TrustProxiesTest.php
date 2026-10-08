<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    Route::get('/__trust-proxies', fn (Request $request) => [
        'secure' => $request->isSecure(),
        'ip' => $request->ip(),
        'url' => url('/x'),
    ]);
});

it('honours the forwarded headers set by the reverse proxy', function () {
    $this->withServerVariables(['REMOTE_ADDR' => '172.18.0.1'])
        ->withHeaders([
            'X-Forwarded-Proto' => 'https',
            'X-Forwarded-For' => '203.0.113.7',
            'X-Forwarded-Host' => 'api.example.test',
            'X-Forwarded-Port' => '443',
        ])
        ->getJson('/__trust-proxies')
        ->assertOk()
        ->assertExactJson([
            'secure' => true,
            'ip' => '203.0.113.7',
            'url' => 'https://api.example.test/x',
        ]);
});

it('uses the proxy-appended address, not one forged by the client', function () {
    $this->withServerVariables(['REMOTE_ADDR' => '172.18.0.1'])
        ->withHeader('X-Forwarded-For', '198.51.100.1, 203.0.113.7')
        ->getJson('/__trust-proxies')
        ->assertOk()
        ->assertJsonPath('ip', '203.0.113.7');
});
