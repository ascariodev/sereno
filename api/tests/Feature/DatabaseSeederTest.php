<?php

use App\Enums\LogGroupStatus;
use App\Models\Channel;
use App\Models\LogEvent;
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
        ->and($user->email_verified_at)->not->toBeNull()
        ->and(Organization::count())->toBe(1)
        ->and($organization->users()->whereKey($user->id)->exists())->toBeTrue()
        ->and(Project::withoutGlobalScopes()->count())->toBe(1)
        ->and(Channel::withoutGlobalScopes()->count())->toBe(1)
        ->and(LogGroup::withoutGlobalScopes()->count())->toBe(1)
        ->and(Message::withoutGlobalScopes()->count())->toBe(4)
        ->and(Message::withoutGlobalScopes()->where('kind', 'user')->count())->toBe(2)
        ->and(Message::withoutGlobalScopes()->where('kind', 'system')->count())->toBe(2)
        ->and(LogGroup::withoutGlobalScopes()->firstOrFail()->status)->toBe(LogGroupStatus::Resolved);
});

it('seeds log events matching each group events_count', function () {
    $this->seed(DatabaseSeeder::class);

    $groups = LogGroup::withoutGlobalScopes()->get();
    expect($groups)->not->toBeEmpty();

    foreach ($groups as $group) {
        expect($group->events_count)->toBeGreaterThan(0)
            ->and(LogEvent::withoutGlobalScopes()->where('log_group_id', $group->id)->count())->toBe($group->events_count);
    }
});
