<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    Route::get('/__trust-proxies', fn (Request $request) => [
        'secure' => $request->isSecure(),
        'ip' => $request->ip(),
        'url' => url('/x'),
    ]);
});

function trustProxiesRequest(array $headers): TestResponse
{
    return test()->withServerVariables(['REMOTE_ADDR' => '172.18.0.1'])
        ->withHeaders($headers)
        ->getJson('http://api.workspace.test/__trust-proxies')
        ->assertOk();
}

it('honours the forwarded proto and client address set by the reverse proxy', function () {
    trustProxiesRequest([
        'X-Forwarded-Proto' => 'https',
        'X-Forwarded-For' => '203.0.113.7',
    ])->assertExactJson([
        'secure' => true,
        'ip' => '203.0.113.7',
        'url' => 'https://api.workspace.test/x',
    ]);
});

it('uses the proxy-appended address, not one forged by the client', function () {
    trustProxiesRequest(['X-Forwarded-For' => '198.51.100.1, 203.0.113.7'])
        ->assertJsonPath('ip', '203.0.113.7');
});

it('ignores a forwarded host forged by the client', function () {
    trustProxiesRequest([
        'X-Forwarded-Proto' => 'https',
        'X-Forwarded-Host' => 'evil.example.test',
    ])->assertJsonPath('url', 'https://api.workspace.test/x');
});

it('ignores a forwarded port forged by the client', function () {
    trustProxiesRequest([
        'X-Forwarded-Proto' => 'https',
        'X-Forwarded-Port' => '8443',
    ])->assertJsonPath('url', 'https://api.workspace.test/x');
});

it('ignores a forwarded prefix forged by the client', function () {
    trustProxiesRequest([
        'X-Forwarded-Proto' => 'https',
        'X-Forwarded-Prefix' => '/evil',
    ])->assertJsonPath('url', 'https://api.workspace.test/x');
});
