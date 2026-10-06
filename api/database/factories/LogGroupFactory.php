<?php

namespace Database\Factories;

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Models\LogGroup;
use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<LogGroup>
 */
class LogGroupFactory extends Factory
{
    public function definition(): array
    {
        $seenAt = fake()->dateTimeBetween('-1 day', 'now');

        return [
            'project_id' => Project::factory(),
            'organization_id' => fn (array $attributes) => Project::withoutGlobalScopes()
                ->whereKey($attributes['project_id'])
                ->value('organization_id'),
            'fingerprint' => hash('sha256', fake()->unique()->uuid()),
            'level' => LogLevel::Error,
            'title' => fake()->sentence(),
            'status' => LogGroupStatus::Open,
            'first_seen_at' => $seenAt,
            'last_seen_at' => $seenAt,
            'events_count' => 1,
        ];
    }

    public function resolved(): static
    {
        return $this->state(['status' => LogGroupStatus::Resolved]);
    }

    public function ignored(): static
    {
        return $this->state(['status' => LogGroupStatus::Ignored]);
    }
}
