<?php

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

it('deletes assignments when the project or the user is deleted', function () {
    $other = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->user);
    $other->addMember($this->user);

    $this->project->delete();
    expect(DB::table('project_user')->count())->toBe(1);

    $this->user->delete();
    expect(DB::table('project_user')->count())->toBe(0);
});
