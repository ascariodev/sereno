<?php

namespace Database\Factories;

use App\Enums\Locale;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Organization>
 */
class OrganizationFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->company(),
            'slug' => fake()->unique()->slug(2),
            'settings' => ['default_locale' => Locale::default()->value],
        ];
    }
}
