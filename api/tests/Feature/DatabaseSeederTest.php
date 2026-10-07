<?php

use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;

it('seeds development data idempotently', function () {
    $this->seed(DatabaseSeeder::class);
    $this->seed(DatabaseSeeder::class);

    $user = User::where('email', 'test@example.com')->firstOrFail();
    $organization = Organization::where('slug', 'demo')->firstOrFail();

    expect(User::where('email', 'test@example.com')->count())->toBe(1)
        ->and(Organization::count())->toBe(1)
        ->and($organization->users()->whereKey($user->id)->exists())->toBeTrue()
        ->and(Project::withoutGlobalScopes()->count())->toBe(1)
        ->and(Channel::withoutGlobalScopes()->count())->toBe(1)
        ->and(LogGroup::withoutGlobalScopes()->count())->toBe(1)
        ->and(Message::withoutGlobalScopes()->count())->toBe(4)
        ->and(Message::withoutGlobalScopes()->where('kind', 'user')->count())->toBe(2)
        ->and(Message::withoutGlobalScopes()->where('kind', 'system')->count())->toBe(2);
});
