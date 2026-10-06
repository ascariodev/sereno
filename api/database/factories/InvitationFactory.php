<?php

namespace Database\Factories;

use App\Enums\Locale;
use App\Enums\Role;
use App\Models\Invitation;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Invitation>
 */
class InvitationFactory extends Factory
{
    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'email' => fake()->unique()->safeEmail(),
            'role' => Role::Member->value,
            'token' => Invitation::hashToken(Invitation::newPlainToken()),
            'locale' => Locale::default()->value,
            'expires_at' => now()->addDays(Invitation::VALID_DAYS),
        ];
    }

    public function withPlainToken(string $plainToken): static
    {
        return $this->state(['token' => Invitation::hashToken($plainToken)]);
    }
}
