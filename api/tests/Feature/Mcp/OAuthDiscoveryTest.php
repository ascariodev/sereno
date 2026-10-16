<?php

it('serves the protected resource metadata', function () {
    $this->getJson('/.well-known/oauth-protected-resource')
        ->assertOk()
        ->assertJson([
            'resource' => url('/'),
            'authorization_servers' => [url('/')],
            'scopes_supported' => ['mcp:use'],
        ]);

    $this->getJson('/.well-known/oauth-protected-resource/mcp')
        ->assertOk()
        ->assertJson(['resource' => url('/mcp'), 'scopes_supported' => ['mcp:use']]);
});

it('serves the authorization server metadata with the web authorization endpoint', function () {
    config(['app.frontend_url' => 'https://sereno.test/']);

    $expected = [
        'issuer' => url('/'),
        'authorization_endpoint' => 'https://sereno.test/oauth/authorize',
        'token_endpoint' => url('/oauth/token'),
        'registration_endpoint' => url('/oauth/register'),
        'response_types_supported' => ['code'],
        'code_challenge_methods_supported' => ['S256'],
        'scopes_supported' => ['mcp:use'],
        'grant_types_supported' => ['authorization_code', 'refresh_token'],
    ];

    $this->getJson('/.well-known/oauth-authorization-server')->assertOk()->assertJson($expected);
    $this->getJson('/.well-known/oauth-authorization-server/mcp')->assertOk()->assertJson($expected);
});

it('points the 401 of /mcp to the resource metadata', function () {
    $response = $this->postJson('/mcp', [], ['Accept' => 'application/json, text/event-stream'])
        ->assertUnauthorized();

    expect($response->headers->get('WWW-Authenticate'))
        ->toBe('Bearer realm="mcp", resource_metadata="'.url('/.well-known/oauth-protected-resource/mcp').'"');
});
