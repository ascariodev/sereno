<?php

use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

it('registers a client with the claude.ai callback', function () {
    $this->postJson('/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => [CLAUDE_CALLBACK]])
        ->assertCreated()
        ->assertJson(['redirect_uris' => [CLAUDE_CALLBACK], 'token_endpoint_auth_method' => 'none']);
});

it('rejects every other redirect uri', function (string $uri) {
    $this->postJson('/oauth/register', ['redirect_uris' => [$uri]])
        ->assertStatus(400)
        ->assertJson(['error' => 'invalid_redirect_uri']);
})->with([
    'other domain' => 'https://evil.com/callback',
    'suffix host' => 'https://claude.ai.evil.com/api/mcp/auth_callback',
    'embedded url' => 'https://evil.com/?x=https://claude.ai/api/mcp/auth_callback',
    'userinfo' => 'https://claude.ai@evil.com/api/mcp/auth_callback',
    'other path' => 'https://claude.ai/other',
    'claude.com' => 'https://claude.com/api/mcp/auth_callback',
    'http' => 'http://claude.ai/api/mcp/auth_callback',
    'loopback' => 'http://localhost:3000/callback',
    'custom scheme' => 'cursor://anysphere.cursor-retrieval/oauth',
]);

it('limits registration per ip', function () {
    RateLimiter::clear('oauth-register');

    foreach (range(1, 10) as $i) {
        $this->postJson('/oauth/register', ['redirect_uris' => [CLAUDE_CALLBACK]])->assertCreated();
    }

    $this->postJson('/oauth/register', ['redirect_uris' => [CLAUDE_CALLBACK]])
        ->assertTooManyRequests()
        ->assertJsonStructure(['message']);
});

it('limits the token endpoint per ip and answers in json', function () {
    $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($key, $privateKey);
    config(['passport.private_key' => $privateKey, 'passport.public_key' => openssl_pkey_get_details($key)['key']]);

    foreach (range(1, 60) as $i) {
        $this->post('/oauth/token', ['grant_type' => 'authorization_code'])->assertStatus(400)->assertJson(['error' => 'invalid_request']);
    }

    $this->post('/oauth/token', ['grant_type' => 'authorization_code'])
        ->assertTooManyRequests()
        ->assertJsonStructure(['message']);
});

it('drops the session based passport routes', function () {
    foreach (['passport.authorizations.authorize', 'passport.device', 'passport.clients.index', 'passport.tokens.index'] as $name) {
        expect(Route::has($name))->toBeFalse();
    }

    expect(Route::has('passport.token'))->toBeTrue();
    $this->get('/oauth/authorize')->assertNotFound();
});
