<?php

use App\Models\User;

it('registers a user and returns a token', function () {
    $this->postJson('/api/auth/register', [
        'name' => 'Ana Perez',
        'email' => 'ana@example.com',
        'password' => 'secret-pass-123',
        'password_confirmation' => 'secret-pass-123',
    ])->assertCreated()
        ->assertJsonStructure(['token', 'user' => ['id', 'name', 'email']])
        ->assertJsonPath('user.email', 'ana@example.com');

    expect(User::where('email', 'ana@example.com')->exists())->toBeTrue();
});

it('validates unique email and password confirmation on register', function () {
    User::factory()->create(['email' => 'ana@example.com']);

    $this->postJson('/api/auth/register', [
        'name' => 'Ana',
        'email' => 'ana@example.com',
        'password' => 'secret-pass-123',
        'password_confirmation' => 'different',
    ])->assertUnprocessable()->assertJsonValidationErrors(['email', 'password']);
});

it('logs in with valid credentials', function () {
    User::factory()->create(['email' => 'ana@example.com']);

    $this->postJson('/api/auth/login', [
        'email' => 'ana@example.com',
        'password' => 'password',
    ])->assertOk()->assertJsonStructure(['token', 'user']);
});

it('rejects invalid credentials', function () {
    User::factory()->create(['email' => 'ana@example.com']);

    $this->postJson('/api/auth/login', [
        'email' => 'ana@example.com',
        'password' => 'wrong',
    ])->assertUnprocessable()->assertJsonValidationErrors('email');
});

it('returns the authenticated user on me', function () {
    $user = User::factory()->create();
    $token = $user->createToken('test')->plainTextToken;

    $this->withToken($token)->getJson('/api/me')
        ->assertOk()
        ->assertJsonPath('data.id', $user->id)
        ->assertJsonPath('data.email', $user->email);
});

it('requires authentication on me', function () {
    $this->getJson('/api/me')->assertUnauthorized();
});

it('revokes the token on logout', function () {
    $user = User::factory()->create();
    $token = $user->createToken('test')->plainTextToken;

    $this->withToken($token)->postJson('/api/auth/logout')->assertNoContent();

    expect($user->tokens()->count())->toBe(0);
});
