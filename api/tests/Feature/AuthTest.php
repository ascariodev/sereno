<?php

use App\Models\User;
use App\Providers\AppServiceProvider;

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

it('throttles login attempts per email and ip', function () {
    User::factory()->create(['email' => 'ana@example.com']);

    foreach (range(1, AppServiceProvider::LOGIN_ATTEMPTS_PER_MINUTE) as $attempt) {
        $this->postJson('/api/auth/login', ['email' => 'ana@example.com', 'password' => 'wrong'])
            ->assertUnprocessable();
    }

    $response = $this->postJson('/api/auth/login', ['email' => 'ana@example.com', 'password' => 'wrong'])
        ->assertTooManyRequests()
        ->assertHeader('Retry-After');

    $response->assertJsonPath('message', __('Too many attempts. Please try again in :seconds seconds.', [
        'seconds' => $response->headers->get('Retry-After'),
    ]));

    $spanish = $this->withHeader('Accept-Language', 'es')
        ->postJson('/api/auth/login', ['email' => 'ana@example.com', 'password' => 'wrong'])
        ->assertTooManyRequests()
        ->assertHeader('Retry-After');

    $spanish->assertJsonPath('message', __('Too many attempts. Please try again in :seconds seconds.', [
        'seconds' => $spanish->headers->get('Retry-After'),
    ], 'es'));
});

it('shares the login counter regardless of email case', function () {
    User::factory()->create(['email' => 'ana@example.com']);

    foreach (range(1, AppServiceProvider::LOGIN_ATTEMPTS_PER_MINUTE) as $attempt) {
        $email = $attempt % 2 === 0 ? 'ANA@Example.com' : 'ana@example.com';

        $this->postJson('/api/auth/login', ['email' => $email, 'password' => 'wrong']);
    }

    $this->postJson('/api/auth/login', ['email' => 'ANA@Example.com', 'password' => 'wrong'])
        ->assertTooManyRequests();
});

it('throttles login per ip across different emails', function () {
    foreach (range(1, AppServiceProvider::LOGIN_ATTEMPTS_PER_IP_PER_MINUTE) as $attempt) {
        $this->postJson('/api/auth/login', ['email' => "user{$attempt}@example.com", 'password' => 'wrong'])
            ->assertUnprocessable();
    }

    $this->postJson('/api/auth/login', ['email' => 'another@example.com', 'password' => 'wrong'])
        ->assertTooManyRequests()
        ->assertHeader('Retry-After');
});

it('does not fail when the login email is an array', function () {
    $this->postJson('/api/auth/login', ['email' => ['ana@example.com'], 'password' => 'wrong'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('email');
});

it('does not throttle login for a different email', function () {
    User::factory()->create(['email' => 'ana@example.com']);
    User::factory()->create(['email' => 'luis@example.com']);

    foreach (range(1, AppServiceProvider::LOGIN_ATTEMPTS_PER_MINUTE + 1) as $attempt) {
        $this->postJson('/api/auth/login', ['email' => 'ana@example.com', 'password' => 'wrong']);
    }

    $this->postJson('/api/auth/login', ['email' => 'luis@example.com', 'password' => 'password'])
        ->assertOk();
});

it('throttles register attempts per ip', function () {
    foreach (range(1, AppServiceProvider::REGISTER_ATTEMPTS_PER_MINUTE) as $attempt) {
        $this->postJson('/api/auth/register', [])->assertUnprocessable();
    }

    $this->postJson('/api/auth/register', [])
        ->assertTooManyRequests()
        ->assertHeader('Retry-After');
});
