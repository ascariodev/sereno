<?php

use App\Models\ExpoPushToken;
use App\Models\User;

function expoPayload(array $overrides = []): array
{
    return array_merge([
        'token' => 'ExponentPushToken[abcDEF123456]',
        'platform' => 'android',
        'device_name' => 'Pixel',
    ], $overrides);
}

function bearer(User $user): array
{
    $new = $user->createToken('device');

    return [$new->accessToken, ['Authorization' => 'Bearer '.$new->plainTextToken]];
}

it('requires authentication', function () {
    $this->postJson('/api/me/expo-push-tokens', expoPayload())->assertUnauthorized();
    $this->deleteJson('/api/me/expo-push-tokens', ['token' => 'ExponentPushToken[x]'])->assertUnauthorized();
});

it('registers the token bound to the current access token', function () {
    $user = User::factory()->create();
    [$access, $headers] = bearer($user);

    $this->postJson('/api/me/expo-push-tokens', expoPayload(), $headers)
        ->assertCreated()
        ->assertJsonPath('data.token', 'ExponentPushToken[abcDEF123456]')
        ->assertJsonPath('data.platform', 'android');

    $record = ExpoPushToken::sole();
    expect($record->user_id)->toBe($user->id)
        ->and($record->personal_access_token_id)->toBe($access->id)
        ->and($record->last_used_at)->not->toBeNull();

    $this->postJson('/api/me/expo-push-tokens', expoPayload(['device_name' => 'Renamed']), $headers)
        ->assertOk();
    expect(ExpoPushToken::count())->toBe(1)
        ->and($record->fresh()->device_name)->toBe('Renamed');
});

it('moves the token to another session and user when registered again', function () {
    $first = User::factory()->create();
    $second = User::factory()->create();
    [, $firstHeaders] = bearer($first);
    [$secondAccess, $secondHeaders] = bearer($second);

    $this->postJson('/api/me/expo-push-tokens', expoPayload(), $firstHeaders)->assertCreated();
    $this->app['auth']->forgetGuards();
    $this->postJson('/api/me/expo-push-tokens', expoPayload(), $secondHeaders)->assertOk();

    $record = ExpoPushToken::sole();
    expect($record->user_id)->toBe($second->id)
        ->and($record->personal_access_token_id)->toBe($secondAccess->id);
});

it('rejects an invalid token or platform', function (array $overrides, string $field) {
    [, $headers] = bearer(User::factory()->create());

    $this->postJson('/api/me/expo-push-tokens', expoPayload($overrides), $headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors($field);
})->with([
    'bad format' => [['token' => 'not-a-token'], 'token'],
    'empty brackets' => [['token' => 'ExponentPushToken[]'], 'token'],
    'missing token' => [['token' => null], 'token'],
    'bad platform' => [['platform' => 'windows'], 'platform'],
]);

it('rejects registration with a transient token', function () {
    $this->actingAs(User::factory()->create(), 'web');

    $this->postJson('/api/me/expo-push-tokens', expoPayload())->assertForbidden();

    expect(ExpoPushToken::count())->toBe(0);
});

it('accepts a null device name', function () {
    [, $headers] = bearer(User::factory()->create());

    $this->postJson('/api/me/expo-push-tokens', expoPayload(['device_name' => null]), $headers)
        ->assertCreated()
        ->assertJsonPath('data.device_name', null);
});

it('limits the device name to 255 characters', function () {
    [, $headers] = bearer(User::factory()->create());

    $this->postJson('/api/me/expo-push-tokens', expoPayload(['device_name' => str_repeat('a', 256)]), $headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors('device_name');
    $this->postJson('/api/me/expo-push-tokens', expoPayload(['device_name' => str_repeat('a', 255)]), $headers)
        ->assertCreated();
});

it('deletes the own token by query string and by body', function () {
    $user = User::factory()->create();
    [, $headers] = bearer($user);
    $one = ExpoPushToken::factory()->for($user)->create();
    $two = ExpoPushToken::factory()->for($user)->create();

    $this->deleteJson('/api/me/expo-push-tokens?'.http_build_query(['token' => $one->token]), [], $headers)->assertNoContent();
    $this->deleteJson('/api/me/expo-push-tokens', ['token' => $two->token], $headers)->assertNoContent();

    expect(ExpoPushToken::count())->toBe(0);
});

it('answers the same 404 for a foreign and a missing token, even with an invalid body', function () {
    [, $headers] = bearer(User::factory()->create());
    $foreign = ExpoPushToken::factory()->create();

    $foreignResponse = $this->deleteJson('/api/me/expo-push-tokens?'.http_build_query(['token' => $foreign->token]), [], $headers);
    $missingResponse = $this->deleteJson('/api/me/expo-push-tokens?'.http_build_query(['token' => 'ExponentPushToken[nope]']), [], $headers);
    $emptyResponse = $this->deleteJson('/api/me/expo-push-tokens', [], $headers);

    $foreignResponse->assertNotFound();
    expect($missingResponse->status())->toBe(404)
        ->and($emptyResponse->status())->toBe(404)
        ->and($missingResponse->json('message'))->toBe($foreignResponse->json('message'))
        ->and($emptyResponse->json('message'))->toBe($foreignResponse->json('message'))
        ->and(ExpoPushToken::count())->toBe(1);
});
