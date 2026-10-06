<?php

use App\Models\User;
use Laravel\Sanctum\Sanctum;

it('returns a 422 in Spanish with Accept-Language es', function () {
    $this->postJson('/api/auth/login', [], ['Accept-Language' => 'es'])
        ->assertUnprocessable()
        ->assertHeader('Content-Language', 'es')
        ->assertJsonPath('errors.email.0', 'El campo correo electrónico es obligatorio.');
});

it('defaults to en without Accept-Language', function () {
    $this->postJson('/api/auth/login', [])
        ->assertUnprocessable()
        ->assertHeader('Content-Language', 'en')
        ->assertJsonPath('errors.email.0', 'The email field is required.');
});

it('falls back to en for an unsupported language', function () {
    $this->postJson('/api/auth/login', [], ['Accept-Language' => 'fr-FR,fr;q=0.9'])
        ->assertHeader('Content-Language', 'en');
});

it('prefers the stored user locale over the header', function () {
    Sanctum::actingAs(User::factory()->create(['locale' => 'es']));

    $this->getJson('/api/me', ['Accept-Language' => 'en'])
        ->assertOk()
        ->assertHeader('Content-Language', 'es')
        ->assertJsonPath('data.locale', 'es');
});

it('uses the header when the user has no stored locale', function () {
    Sanctum::actingAs(User::factory()->create());

    $this->getJson('/api/me', ['Accept-Language' => 'es'])
        ->assertHeader('Content-Language', 'es')
        ->assertJsonPath('data.locale', null);
});

it('returns a translated 401 with Content-Language', function () {
    $messages = [];

    foreach (['en', 'es'] as $locale) {
        $response = $this->getJson('/api/me', ['Accept-Language' => $locale])
            ->assertUnauthorized()
            ->assertHeader('Content-Language', $locale);

        $messages[$locale] = $response->json('message');
    }

    expect($messages['en'])->toBe(__('Unauthenticated.', [], 'en'))
        ->and($messages['es'])->toBe(__('Unauthenticated.', [], 'es'))
        ->and($messages['es'])->not->toBe($messages['en']);
});

it('updates the locale through PATCH /me/locale', function () {
    $user = User::factory()->create();
    Sanctum::actingAs($user);

    $this->patchJson('/api/me/locale', ['locale' => 'es'])
        ->assertOk()
        ->assertJsonPath('data.locale', 'es');

    expect($user->fresh()->locale->value)->toBe('es');
});

it('rejects an unsupported locale and requires auth', function () {
    $this->patchJson('/api/me/locale', ['locale' => 'es'])->assertUnauthorized();

    Sanctum::actingAs(User::factory()->create());
    $this->patchJson('/api/me/locale', ['locale' => 'fr'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['locale']);
});
