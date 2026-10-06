<?php

namespace Database\Factories;

use App\Models\LogSource;
use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<LogSource>
 */
class LogSourceFactory extends Factory
{
    public function definition(): array
    {
        $plainKey = LogSource::newPlainKey();

        return [
            'project_id' => Project::factory(),
            'organization_id' => fn (array $attributes) => Project::withoutGlobalScopes()
                ->whereKey($attributes['project_id'])
                ->value('organization_id'),
            'name' => fake()->unique()->words(2, true),
            'key_hash' => LogSource::hashKey($plainKey),
            'key_prefix' => LogSource::displayPrefix($plainKey),
            'last_used_at' => null,
            'revoked_at' => null,
        ];
    }

    public function withPlainKey(string $plainKey): static
    {
        return $this->state([
            'key_hash' => LogSource::hashKey($plainKey),
            'key_prefix' => LogSource::displayPrefix($plainKey),
        ]);
    }

    public function revoked(): static
    {
        return $this->state(['revoked_at' => now()]);
    }
}
