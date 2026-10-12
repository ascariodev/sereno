<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    $this->user = User::factory()->create();
});

it('assigns and removes a member with the organization filled', function () {
    $this->project->addMember($this->user);

    expect($this->project->members()->pluck('users.id')->all())->toBe([$this->user->id])
        ->and(DB::table('project_user')->value('organization_id'))->toBe($this->organization->id)
        ->and($this->user->projects()->withoutGlobalScopes()->pluck('projects.id')->all())->toBe([$this->project->id]);

    $this->project->removeMember($this->user);

    expect(DB::table('project_user')->count())->toBe(0);
});

it('does not duplicate an assignment through addMember', function () {
    $this->project->addMember($this->user);
    $this->project->addMember($this->user);

    expect(DB::table('project_user')->count())->toBe(1);
});

it('rejects a duplicate row at the database', function () {
    $row = [
        'organization_id' => $this->organization->id,
        'project_id' => $this->project->id,
        'user_id' => $this->user->id,
    ];
    DB::table('project_user')->insert($row);

    expect(fn () => DB::table('project_user')->insert($row))->toThrow(QueryException::class);
});

it('rejects a row whose organization differs from its project at the database', function () {
    $other = Organization::factory()->create();

    expect(fn () => DB::table('project_user')->insert([
        'organization_id' => $other->id,
        'project_id' => $this->project->id,
        'user_id' => $this->user->id,
    ]))->toThrow(QueryException::class, 'project_user_project_organization_fk');
});

it('deletes assignments when the project or the user is deleted', function () {
    $other = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->user);
    $other->addMember($this->user);

    $this->project->delete();
    expect(DB::table('project_user')->count())->toBe(1);

    $this->user->delete();
    expect(DB::table('project_user')->count())->toBe(0);
});

it('assigns current members to every project of their organization through the data migration', function () {
    $archived = Project::factory()->for($this->organization)->create(['archived_at' => now()]);
    $owner = User::factory()->create();
    $admin = User::factory()->create();
    $member = User::factory()->create();
    $this->organization->addMember($owner, [Role::Owner]);
    $this->organization->addMember($admin, [Role::Admin]);
    $this->organization->addMember($member, [Role::Member]);

    $otherOrganization = Organization::factory()->create();
    Project::factory()->for($otherOrganization)->create();
    $otherOrganization->addMember($owner, [Role::Member]);

    $migration = require database_path('migrations/2026_10_10_110000_assign_members_to_their_projects.php');
    $migration->up();
    $migration->up();

    $rows = DB::table('project_user')->orderBy('project_id')->get();
    expect($rows)->toHaveCount(3)
        ->and($rows->where('user_id', $member->id)->pluck('project_id')->all())->toBe([$this->project->id, $archived->id])
        ->and($rows->where('user_id', $member->id)->pluck('organization_id')->unique()->all())->toBe([$this->organization->id])
        ->and($rows->where('user_id', $owner->id)->pluck('organization_id')->all())->toBe([$otherOrganization->id])
        ->and($rows->where('user_id', $admin->id))->toBeEmpty();
});

it('keeps the assignMembersToAllProjects helper equal to the data migration', function () {
    Project::factory()->for($this->organization)->create(['archived_at' => now()]);
    $this->organization->addMember(User::factory()->create(), [Role::Owner]);
    $this->organization->addMember(User::factory()->create(), [Role::Admin]);
    $this->organization->addMember(User::factory()->create(), [Role::Member]);
    $otherOrganization = Organization::factory()->create();
    Project::factory()->for($otherOrganization)->create();
    $otherOrganization->addMember(User::factory()->create(), [Role::Member]);

    $pairs = fn () => DB::table('project_user')
        ->orderBy('project_id')->orderBy('user_id')
        ->get(['organization_id', 'project_id', 'user_id'])->toArray();

    assignMembersToAllProjects();
    $fromHelper = $pairs();
    DB::table('project_user')->delete();

    (require database_path('migrations/2026_10_10_110000_assign_members_to_their_projects.php'))->up();

    expect($fromHelper)->not->toBeEmpty()->and($pairs())->toEqual($fromHelper);
});
