<?php

namespace Database\Factories;

use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<PushSubscription>
 */
class PushSubscriptionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'endpoint' => 'https://push.example.test/send/'.Str::random(40),
            'public_key' => Str::random(87),
            'auth_token' => Str::random(22),
            'content_encoding' => 'aes128gcm',
            'user_agent' => fake()->userAgent(),
        ];
    }
}
