<?php

use App\Models\PushSubscription;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->user = User::factory()->create();
    Sanctum::actingAs($this->user);
    $this->payload = [
        'endpoint' => 'https://push.example.test/send/abc123',
        'public_key' => 'BPublicKeyValue',
        'auth_token' => 'authTokenValue',
        'content_encoding' => 'aesgcm',
        'user_agent' => 'Pest',
    ];
});

it('returns the vapid public key', function () {
    config(['workspace.push.vapid_public_key' => 'BVapidPublic']);

    $this->getJson('/api/push/vapid-public-key')->assertOk()->assertExactJson(['data' => ['public_key' => 'BVapidPublic']]);
});

it('answers 503 when vapid is not configured, translated', function () {
    config(['workspace.push.vapid_public_key' => null]);

    $this->getJson('/api/push/vapid-public-key', ['Accept-Language' => 'es'])
        ->assertStatus(503)
        ->assertJsonPath('message', 'Las notificaciones push no están configuradas.');
});

it('requires authentication', function () {
    $this->app['auth']->forgetGuards();
    $this->refreshApplication();

    $this->getJson('/api/push/vapid-public-key')->assertUnauthorized();
    $this->postJson('/api/me/push-subscriptions', [])->assertUnauthorized();
    $this->deleteJson('/api/me/push-subscriptions', [])->assertUnauthorized();
});

it('creates a subscription and updates it idempotently', function () {
    $this->postJson('/api/me/push-subscriptions', $this->payload)
        ->assertCreated()
        ->assertJsonPath('data.endpoint', $this->payload['endpoint'])
        ->assertJsonPath('data.content_encoding', 'aesgcm')
        ->assertJsonMissingPath('data.auth_token');

    $this->postJson('/api/me/push-subscriptions', [...$this->payload, 'auth_token' => 'rotated'])->assertOk();

    expect(PushSubscription::count())->toBe(1)
        ->and(PushSubscription::first())->user_id->toBe($this->user->id)
        ->auth_token->toBe('rotated')
        ->last_used_at->not->toBeNull();
});

it('defaults the content encoding', function () {
    unset($this->payload['content_encoding']);

    $this->postJson('/api/me/push-subscriptions', $this->payload)->assertCreated()
        ->assertJsonPath('data.content_encoding', 'aes128gcm');
});

it('moves an endpoint from another user to the current one', function () {
    $other = User::factory()->create();
    PushSubscription::factory()->create(['user_id' => $other->id, 'endpoint' => $this->payload['endpoint']]);

    $this->postJson('/api/me/push-subscriptions', $this->payload)->assertOk();

    expect(PushSubscription::count())->toBe(1)
        ->and(PushSubscription::first()->user_id)->toBe($this->user->id)
        ->and($other->pushSubscriptions()->count())->toBe(0);
});

it('validates the subscription body', function (array $override, string $field) {
    $this->postJson('/api/me/push-subscriptions', [...$this->payload, ...$override])
        ->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'missing endpoint' => [['endpoint' => null], 'endpoint'],
    'http endpoint' => [['endpoint' => 'http://push.example.test/x'], 'endpoint'],
    'not a url' => [['endpoint' => 'nope'], 'endpoint'],
    'long endpoint' => [['endpoint' => 'https://push.example.test/'.str_repeat('a', 2100)], 'endpoint'],
    'missing key' => [['public_key' => null], 'public_key'],
    'long key' => [['public_key' => str_repeat('a', 256)], 'public_key'],
    'missing auth' => [['auth_token' => null], 'auth_token'],
    'bad encoding' => [['content_encoding' => 'rot13'], 'content_encoding'],
    'long agent' => [['user_agent' => str_repeat('a', 513)], 'user_agent'],
]);

it('deletes the own subscription', function () {
    $own = PushSubscription::factory()->create(['user_id' => $this->user->id]);

    $this->deleteJson('/api/me/push-subscriptions', ['endpoint' => $own->endpoint])->assertNoContent();

    expect(PushSubscription::count())->toBe(0);
});

it('deletes the own subscription by query string', function () {
    $own = PushSubscription::factory()->create(['user_id' => $this->user->id]);

    $this->deleteJson('/api/me/push-subscriptions?'.http_build_query(['endpoint' => $own->endpoint]))->assertNoContent();

    expect(PushSubscription::count())->toBe(0);
});

it('rejects deleting a foreign subscription by query string as if it did not exist', function () {
    $foreign = PushSubscription::factory()->create();

    $missing = $this->deleteJson('/api/me/push-subscriptions?'.http_build_query(['endpoint' => 'https://push.example.test/none']));
    $other = $this->deleteJson('/api/me/push-subscriptions?'.http_build_query(['endpoint' => $foreign->endpoint]));

    $other->assertNotFound();
    expect($other->json('message'))->toBe($missing->json('message'))
        ->and(PushSubscription::count())->toBe(1);
});

it('rejects deleting a foreign subscription as if it did not exist', function () {
    $foreign = PushSubscription::factory()->create();

    $missing = $this->deleteJson('/api/me/push-subscriptions', ['endpoint' => 'https://push.example.test/none']);
    $other = $this->deleteJson('/api/me/push-subscriptions', ['endpoint' => $foreign->endpoint]);
    $invalid = $this->deleteJson('/api/me/push-subscriptions', ['endpoint' => $foreign->endpoint, 'extra' => 1]);
    $noBody = $this->deleteJson('/api/me/push-subscriptions');

    $other->assertNotFound();
    expect($other->json('message'))->toBe($missing->json('message'))
        ->and($invalid->json('message'))->toBe($missing->json('message'))
        ->and($noBody->status())->toBe(404)
        ->and(PushSubscription::count())->toBe(1);
});
