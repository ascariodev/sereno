<?php

const SPA_ORIGIN = 'http://localhost:5174';

it('answers preflight requests from the SPA origin', function (string $uri, string $method) {
    $response = $this->call('OPTIONS', $uri, server: [
        'HTTP_ORIGIN' => SPA_ORIGIN,
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => $method,
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,x-organization-id',
    ]);

    expect($response->headers->get('Access-Control-Allow-Origin'))->not->toBeNull();
    expect(strtolower($response->headers->get('Access-Control-Allow-Headers')))->toContain('x-organization-id');
})->with([
    'broadcasting auth' => ['/broadcasting/auth', 'POST'],
    'api me' => ['/api/me', 'GET'],
]);

it('sends the allow origin header on actual API responses', function () {
    $response = $this->getJson('/api/me', ['Origin' => SPA_ORIGIN]);

    expect($response->headers->get('Access-Control-Allow-Origin'))->not->toBeNull();
});
