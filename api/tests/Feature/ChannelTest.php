<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Gate;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();

    $this->users = [];
    foreach (Role::cases() as $role) {
        $user = User::factory()->create();
        $this->organization->addMember($user, [$role]);
        $this->users[$role->value] = $user;
    }

    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
});

it('fills the organization and casts archived_at', function () {
    $channel = Channel::factory()->for($this->project)->archived()->create();
    $channel->refresh();

    expect($channel->organization_id)->toBe($this->organization->id)
        ->and($channel->isArchived())->toBeTrue()
        ->and($channel->project->is($this->project))->toBeTrue();
});

it('rejects a second channel for the same project', function () {
    Channel::factory()->for($this->project)->create();
    Channel::factory()->for($this->project)->create();
})->throws(QueryException::class);

it('rejects a project from another organization', function () {
    $foreign = Project::factory()->for($this->other)->create();

    $channel = Channel::query()->create(['name' => 'X']);
    $channel->project_id = $foreign->id;
    $channel->save();
})->throws(InvalidArgumentException::class);

it('rejects creating a channel with a project from another organization', function () {
    $foreign = Project::factory()->for($this->other)->create();

    $channel = new Channel(['name' => 'X']);
    $channel->project_id = $foreign->id;
    $channel->save();
})->throws(InvalidArgumentException::class);

it('allows a channel with no project', function () {
    $channel = Channel::query()->create(['name' => 'general']);

    expect($channel->fresh()->project_id)->toBeNull();
});

it('deletes the channel with its project', function () {
    $channel = Channel::factory()->for($this->project)->create();

    $this->project->delete();

    expect(Channel::query()->whereKey($channel->id)->exists())->toBeFalse();
});

it('lets only owners and admins create, update and archive', function (Role $role, bool $allowed) {
    $user = $this->users[$role->value];
    $channel = Channel::factory()->for($this->project)->create();

    expect(Gate::forUser($user)->allows('create', Channel::class))->toBe($allowed)
        ->and(Gate::forUser($user)->allows('update', $channel))->toBe($allowed)
        ->and(Gate::forUser($user)->allows('archive', $channel))->toBe($allowed);
})->with([
    'owner' => [Role::Owner, true],
    'admin' => [Role::Admin, true],
    'member' => [Role::Member, false],
]);

it('lets any member view', function (Role $role) {
    $channel = Channel::factory()->for($this->project)->create();
    $user = $this->users[$role->value];

    expect(Gate::forUser($user)->allows('viewAny', Channel::class))->toBeTrue()
        ->and(Gate::forUser($user)->allows('view', $channel))->toBeTrue();
})->with([Role::Owner, Role::Admin, Role::Member]);

it('denies a user with no role in the active organization', function () {
    $channel = Channel::factory()->for($this->project)->create();
    $outsider = User::factory()->create();

    expect(Gate::forUser($outsider)->allows('view', $channel))->toBeFalse()
        ->and(Gate::forUser($outsider)->allows('create', Channel::class))->toBeFalse();
});

it('denies everything on a channel of another organization', function () {
    $foreign = Channel::factory()->for(Project::factory()->for($this->other)->create())->create();
    $owner = $this->users['owner'];

    expect(Gate::forUser($owner)->allows('view', $foreign))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('update', $foreign))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('archive', $foreign))->toBeFalse();
});

it('denies everything when there is no active organization', function () {
    $channel = Channel::factory()->for($this->project)->create();
    app(CurrentOrganization::class)->set(null);
    $owner = $this->users['owner'];

    expect(Gate::forUser($owner)->allows('viewAny', Channel::class))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('view', $channel))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('create', Channel::class))->toBeFalse();
});

it('hides channels of other organizations at model level', function () {
    $mine = Channel::factory()->for($this->project)->create();
    $foreign = Channel::factory()->for(Project::factory()->for($this->other)->create())->create();

    expect(Channel::query()->pluck('id')->all())->toBe([$mine->id])
        ->and(Channel::query()->find($foreign->id))->toBeNull();

    app(CurrentOrganization::class)->set($this->other);

    expect(Channel::query()->pluck('id')->all())->toBe([$foreign->id]);
});
