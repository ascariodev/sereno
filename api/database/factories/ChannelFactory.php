<?php

namespace Database\Factories;

use App\Models\Channel;
use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Channel>
 */
class ChannelFactory extends Factory
{
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'organization_id' => fn (array $attributes) => Project::withoutGlobalScopes()
                ->whereKey($attributes['project_id'])
                ->value('organization_id'),
            'name' => strtoupper(fake()->unique()->lexify('???')),
            'archived_at' => null,
        ];
    }

    public function archived(): static
    {
        return $this->state(['archived_at' => now()]);
    }
}
