<?php

namespace Database\Factories;

use App\Models\ExpoPushToken;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<ExpoPushToken>
 */
class ExpoPushTokenFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'personal_access_token_id' => fn (array $attributes) => User::findOrFail($attributes['user_id'])
                ->createToken('device')->accessToken->id,
            'token' => 'ExponentPushToken['.Str::random(22).']',
            'platform' => 'android',
            'device_name' => fake()->word(),
        ];
    }
}
