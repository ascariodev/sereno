<?php

use App\Enums\Role;
use App\Http\Middleware\SetLocale;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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

it('returns a translated JSON 401 on api routes without Accept: application/json', function () {
    $this->withHeaders(['Accept' => '*/*', 'Accept-Language' => 'es'])
        ->get('/api/me')
        ->assertUnauthorized()
        ->assertJsonPath('message', __('Unauthenticated.', [], 'es'));
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

it('adds Vary Accept-Language without overriding an existing Vary', function () {
    $this->postJson('/api/auth/login', [])->assertHeader('Vary', 'Accept-Language');

    $middleware = new SetLocale;
    $response = $middleware->handle(
        Request::create('/x'),
        fn () => response('ok', 200, ['Vary' => 'Origin']),
    );

    expect($response->headers->all('Vary'))->toBe(['Origin', 'Accept-Language']);
});

it('does not query personal_access_tokens for an ingest API key bearer', function () {
    $tokenQueries = function (string $bearer): int {
        $count = 0;
        DB::listen(function ($query) use (&$count) {
            if (str_contains($query->sql, 'personal_access_tokens')) {
                $count++;
            }
        });

        test()->postJson('/api/auth/login', [], ['Authorization' => 'Bearer '.$bearer, 'Accept-Language' => 'es'])
            ->assertHeader('Content-Language', 'es');

        return $count;
    };

    expect($tokenQueries('wsk_abc123'))->toBe(0)
        ->and($tokenQueries('1|plain'))->toBeGreaterThan(0);
});

it('keeps using the user locale with a real Sanctum bearer token', function () {
    $token = User::factory()->create(['locale' => 'es'])->createToken('t')->plainTextToken;

    $this->getJson('/api/me', ['Authorization' => 'Bearer '.$token, 'Accept-Language' => 'en'])
        ->assertOk()
        ->assertHeader('Content-Language', 'es');
});

it('returns a translated 404 for a missing model without exposing class or id', function () {
    $organization = Organization::factory()->create();
    $user = User::factory()->create();
    $organization->addMember($user, [Role::Member]);
    Sanctum::actingAs($user);

    $messages = [];
    foreach (['en', 'es'] as $locale) {
        $response = $this->withHeaders(['X-Organization-Id' => (string) $organization->id, 'Accept-Language' => $locale])
            ->getJson('/api/projects/987654')
            ->assertNotFound()
            ->assertHeader('Content-Language', $locale);

        $messages[$locale] = $response->json('message');
    }

    expect($messages['en'])->toBe(__('Resource not found.', [], 'en'))
        ->and($messages['es'])->toBe(__('Resource not found.', [], 'es'))
        ->and($messages['es'])->not->toBe($messages['en'])
        ->and($messages['en'])->not->toContain('App\\Models')->not->toContain('987654');
});
