<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\ProjectAccess;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->assigned = Project::factory()->for($this->organization)->create();
    $this->unassigned = Project::factory()->for($this->organization)->create();

    $this->users = [];
    foreach (Role::cases() as $role) {
        $user = User::factory()->create();
        $this->organization->addMember($user, [$role]);
        $this->users[$role->value] = $user;
    }
    $this->assigned->addMember($this->users['member']);

    $this->foreign = Project::factory()->for(Organization::factory()->create())->create();
});

function accessAs(string $role)
{
    Sanctum::actingAs(test()->users[$role]);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id);
}

it('lists only assigned projects to a member and all to owner and admin', function (string $role, int $count) {
    accessAs($role)->getJson('/api/projects')
        ->assertOk()
        ->assertJsonCount($count, 'data');
})->with([
    'owner' => ['owner', 2],
    'admin' => ['admin', 2],
    'member' => ['member', 1],
]);

it('shows the assigned project and hides the other as not found', function () {
    accessAs('member')->getJson("/api/projects/{$this->assigned->id}")->assertOk();
    accessAs('member')->getJson("/api/projects/{$this->unassigned->id}")->assertNotFound();
});

it('shows every project to owner and admin', function (string $role) {
    accessAs($role)->getJson("/api/projects/{$this->unassigned->id}")->assertOk();
})->with(['owner', 'admin']);

it('resolves access with an explicit organization and no active team', function () {
    $member = $this->users['member'];
    setPermissionsTeamId(null);

    expect(ProjectAccess::canView($member, $this->assigned))->toBeTrue()
        ->and(ProjectAccess::canView($member, $this->unassigned))->toBeFalse()
        ->and(ProjectAccess::canView($this->users['admin'], $this->unassigned))->toBeTrue()
        ->and(ProjectAccess::canViewId($member, $this->organization->id, $this->assigned->id))->toBeTrue()
        ->and(ProjectAccess::visibleProjectIds($member, $this->organization->id)->all())->toBe([$this->assigned->id])
        ->and(ProjectAccess::visibleProjectIds($this->users['owner'], $this->organization->id)->sort()->values()->all())
        ->toBe([$this->assigned->id, $this->unassigned->id])
        ->and(getPermissionsTeamId())->toBeNull();
});

it('restores a previous non-null spatie team after resolving access', function () {
    $otherTeamId = $this->organization->id + 1000;
    setPermissionsTeamId($otherTeamId);

    expect(ProjectAccess::canView($this->users['member'], $this->assigned))->toBeTrue()
        ->and(getPermissionsTeamId())->toBe($otherTeamId);
});

it('restores the previous spatie team when the role lookup throws', function () {
    $otherTeamId = $this->organization->id + 1000;
    setPermissionsTeamId($otherTeamId);

    $failing = new class extends User
    {
        protected $table = 'users';

        public function hasAnyRole(...$roles): bool
        {
            throw new RuntimeException('role lookup failed');
        }
    };

    expect(fn () => ProjectAccess::seesAll($failing, $this->organization->id))
        ->toThrow(RuntimeException::class, 'role lookup failed')
        ->and(getPermissionsTeamId())->toBe($otherTeamId);
});

it('denies users without a role in the organization, even with a stray assignment', function () {
    $outsider = User::factory()->create();
    $this->assigned->addMember($outsider);

    expect(ProjectAccess::canView($outsider, $this->assigned))->toBeFalse()
        ->and(ProjectAccess::canView($this->users['owner'], $this->foreign))->toBeFalse()
        ->and(ProjectAccess::visibleProjectIds($outsider, $this->organization->id))->toBeEmpty();
});

it('resolves access for many users at once, keeping order', function () {
    $stray = User::factory()->create();
    $this->assigned->addMember($stray);
    $unassignedMember = User::factory()->create();
    $this->organization->addMember($unassignedMember, [Role::Member]);
    $ids = [$stray->id, $this->users['member']->id, $unassignedMember->id, $this->users['admin']->id, $this->users['owner']->id];

    expect(ProjectAccess::viewableUserIds($ids, $this->organization->id, $this->assigned->id))
        ->toBe([$this->users['member']->id, $this->users['admin']->id, $this->users['owner']->id])
        ->and(ProjectAccess::viewableUserIds($ids, $this->organization->id, $this->unassigned->id))
        ->toBe([$this->users['admin']->id, $this->users['owner']->id])
        ->and(ProjectAccess::viewableUserIds([], $this->organization->id, $this->assigned->id))->toBe([]);
});

it('gives canViewId the same answer with and without lock', function () {
    $stranger = User::factory()->create();
    $cases = [
        ['owner', $this->users['owner'], $this->unassigned, true],
        ['admin', $this->users['admin'], $this->unassigned, true],
        ['assigned member', $this->users['member'], $this->assigned, true],
        ['unassigned member', $this->users['member'], $this->unassigned, false],
        ['no role', $stranger, $this->assigned, false],
    ];

    foreach ($cases as [$label, $user, $project, $expected]) {
        expect(ProjectAccess::canViewId($user, $this->organization->id, $project->id))->toBe($expected, $label)
            ->and(ProjectAccess::canViewId($user, $this->organization->id, $project->id, lock: true))->toBe($expected, $label);
    }
});
