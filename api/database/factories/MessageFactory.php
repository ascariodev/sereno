<?php

namespace Database\Factories;

use App\Models\Channel;
use App\Models\Message;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Message>
 */
class MessageFactory extends Factory
{
    public function definition(): array
    {
        return [
            'channel_id' => Channel::factory(),
            'organization_id' => fn (array $attributes) => Channel::withoutGlobalScopes()
                ->whereKey($attributes['channel_id'])
                ->value('organization_id'),
            'user_id' => User::factory(),
            'kind' => Message::KIND_USER,
            'body' => fake()->sentence(),
            'payload' => null,
        ];
    }

    public function system(array $payload = ['type' => 'log.group_opened']): static
    {
        return $this->state([
            'user_id' => null,
            'kind' => Message::KIND_SYSTEM,
            'body' => null,
            'payload' => $payload,
        ]);
    }
}
