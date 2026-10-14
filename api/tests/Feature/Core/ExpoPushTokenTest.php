<?php

use App\Models\ExpoPushToken;
use App\Models\User;
use Illuminate\Database\QueryException;

it('belongs to a user and to the access token of the device', function () {
    $user = User::factory()->create();
    $token = ExpoPushToken::factory()->create(['user_id' => $user->id]);

    expect($user->expoPushTokens()->pluck('id')->all())->toBe([$token->id])
        ->and($token->user->is($user))->toBeTrue()
        ->and($token->accessToken->tokenable_id)->toBe($user->id)
        ->and($token->platform)->toBe('android');
});

it('is deleted with its access token', function () {
    $token = ExpoPushToken::factory()->create();
    $other = ExpoPushToken::factory()->create();

    $token->accessToken->delete();

    expect(ExpoPushToken::query()->pluck('id')->all())->toBe([$other->id]);
});

it('is deleted with its user', function () {
    $user = User::factory()->create();
    ExpoPushToken::factory()->count(2)->create(['user_id' => $user->id]);
    $other = ExpoPushToken::factory()->create();

    $user->delete();

    expect(ExpoPushToken::query()->pluck('id')->all())->toBe([$other->id]);
});

it('rejects a duplicate token', function () {
    $first = ExpoPushToken::factory()->create();

    expect(fn () => ExpoPushToken::factory()->create(['token' => $first->token]))
        ->toThrow(QueryException::class);
});

it('rejects an unknown platform', function () {
    expect(fn () => ExpoPushToken::factory()->create(['platform' => 'windows']))
        ->toThrow(QueryException::class, 'expo_push_tokens_platform_check');
});
