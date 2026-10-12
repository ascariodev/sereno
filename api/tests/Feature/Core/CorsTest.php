<?php

$spaOrigin = 'http://localhost:5174';

it('answers preflight requests from the SPA origin', function (string $uri, string $method) use ($spaOrigin) {
    $response = $this->call('OPTIONS', $uri, server: [
        'HTTP_ORIGIN' => $spaOrigin,
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => $method,
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,x-organization-id',
    ]);

    expect($response->headers->get('Access-Control-Allow-Origin'))->toBe('*');
    expect(strtolower($response->headers->get('Access-Control-Allow-Headers')))->toContain('x-organization-id');
})->with([
    'broadcasting auth' => ['/broadcasting/auth', 'POST'],
    'api me' => ['/api/me', 'GET'],
]);

it('sends the allow origin header on actual API responses', function () use ($spaOrigin) {
    $response = $this->getJson('/api/me', ['Origin' => $spaOrigin]);

    expect($response->headers->get('Access-Control-Allow-Origin'))->toBe('*');
});
