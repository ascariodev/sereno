<?php

use App\Enums\Role;
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

it('lets only owners and admins create, update and archive', function (Role $role, bool $allowed) {
    $user = $this->users[$role->value];

    expect(Gate::forUser($user)->allows('create', Project::class))->toBe($allowed)
        ->and(Gate::forUser($user)->allows('update', $this->project))->toBe($allowed)
        ->and(Gate::forUser($user)->allows('archive', $this->project))->toBe($allowed);
})->with([
    'owner' => [Role::Owner, true],
    'admin' => [Role::Admin, true],
    'member' => [Role::Member, false],
]);

it('lets any member view', function (Role $role) {
    $user = $this->users[$role->value];

    expect(Gate::forUser($user)->allows('viewAny', Project::class))->toBeTrue()
        ->and(Gate::forUser($user)->allows('view', $this->project))->toBeTrue();
})->with([Role::Owner, Role::Admin, Role::Member]);

it('denies a user with no role in the active organization', function () {
    $outsider = User::factory()->create();

    expect(Gate::forUser($outsider)->allows('view', $this->project))->toBeFalse()
        ->and(Gate::forUser($outsider)->allows('create', Project::class))->toBeFalse();
});

it('denies everything on a project of another organization', function () {
    $foreign = Project::factory()->for($this->other)->create();
    $owner = $this->users['owner'];

    expect(Gate::forUser($owner)->allows('view', $foreign))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('update', $foreign))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('archive', $foreign))->toBeFalse();
});

it('denies everything when there is no active organization', function () {
    app(CurrentOrganization::class)->set(null);
    $owner = $this->users['owner'];

    expect(Gate::forUser($owner)->allows('viewAny', Project::class))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('create', Project::class))->toBeFalse();
});

it('hides projects of other organizations at model level', function () {
    $foreign = Project::factory()->for($this->other)->create();

    expect(Project::query()->pluck('id')->all())->toBe([$this->project->id])
        ->and(Project::query()->find($foreign->id))->toBeNull();

    app(CurrentOrganization::class)->set($this->other);

    expect(Project::query()->pluck('id')->all())->toBe([$foreign->id]);
});

it('assigns the active organization on create', function () {
    $project = Project::query()->create(['name' => 'Core', 'key' => 'CORE']);
    expect($project->organization_id)->toBe($this->organization->id);
});

it('rejects duplicate keys within an organization but not across organizations', function () {
    Project::factory()->for($this->other)->create(['key' => 'WEB']);
    Project::factory()->for($this->organization)->create(['key' => 'WEB']);

    expect(Project::query()->where('key', 'WEB')->count())->toBe(1);

    Project::factory()->for($this->organization)->create(['key' => 'WEB']);
})->throws(QueryException::class);

it('rejects keys that break the format', function (string $key) {
    Project::factory()->for($this->organization)->create(['key' => $key]);
})->with(['a', 'web', '1AB', 'A-B', 'ABCDEFGHIJK'])->throws(QueryException::class);
