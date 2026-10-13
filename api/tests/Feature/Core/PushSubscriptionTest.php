<?php

use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Database\QueryException;

it('belongs to a user and is listed from the user', function () {
    $user = User::factory()->create();
    $subscription = PushSubscription::factory()->create(['user_id' => $user->id]);

    expect($user->pushSubscriptions()->pluck('id')->all())->toBe([$subscription->id])
        ->and($subscription->user->is($user))->toBeTrue()
        ->and($subscription->content_encoding)->toBe('aes128gcm')
        ->and($subscription->toArray())->not->toHaveKeys(['public_key', 'auth_token']);
});

it('rejects a duplicate endpoint', function () {
    $first = PushSubscription::factory()->create();

    expect(fn () => PushSubscription::factory()->create(['endpoint' => $first->endpoint]))
        ->toThrow(QueryException::class);
});

it('deletes the subscriptions with their user', function () {
    $user = User::factory()->create();
    PushSubscription::factory()->count(2)->create(['user_id' => $user->id]);
    $other = PushSubscription::factory()->create();

    $user->delete();

    expect(PushSubscription::query()->pluck('id')->all())->toBe([$other->id]);
});
