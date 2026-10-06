<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Project>
 */
class ProjectFactory extends Factory
{
    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'name' => fake()->unique()->words(2, true),
            'key' => strtoupper(fake()->unique()->lexify('???')),
            'description' => null,
            'archived_at' => null,
        ];
    }

    public function archived(): static
    {
        return $this->state(['archived_at' => now()]);
    }
}
