<?php

use App\Enums\Role;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);

    $this->mine = Project::factory()->for($this->organization)->create();
    $this->foreign = Project::factory()->for($this->organization)->create();
    $this->mine->addMember($this->member);
    $this->foreignGroup = LogGroup::factory()->for($this->foreign)->create();
    $this->mineGroup = LogGroup::factory()->for($this->mine)->create();
});

function logAccessCall(User $user, Organization $organization, string $method, string $path, array $payload = [])
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)->json($method, "/api/projects{$path}", $payload);
}

it('hides the log groups and sources of a project the member is not assigned to', function () {
    $base = "/{$this->foreign->id}";
    $group = $this->foreignGroup;

    logAccessCall($this->member, $this->organization, 'GET', "{$base}/log-groups")->assertNotFound();
    logAccessCall($this->member, $this->organization, 'GET', "{$base}/log-groups/hourly?ids={$group->id}")->assertNotFound();
    logAccessCall($this->member, $this->organization, 'GET', "{$base}/log-groups/{$group->id}")->assertNotFound();
    logAccessCall($this->member, $this->organization, 'PATCH', "{$base}/log-groups/{$group->id}", ['status' => 'resolved'])->assertNotFound();
    logAccessCall($this->member, $this->organization, 'GET', "{$base}/log-sources")->assertNotFound();

    expect($group->fresh()->status)->toBe($group->status);
});

it('hides creating a task from a log group of a foreign project', function () {
    logAccessCall($this->member, $this->organization, 'POST', "/{$this->foreign->id}/tasks", [
        'title' => 'From alert', 'log_group_id' => $this->foreignGroup->id,
    ])->assertNotFound();
});

it('lets assigned members, admins and owners read the logs', function () {
    $group = $this->mineGroup;

    logAccessCall($this->member, $this->organization, 'GET', "/{$this->mine->id}/log-groups")->assertOk();
    logAccessCall($this->member, $this->organization, 'GET', "/{$this->mine->id}/log-groups/hourly?ids={$group->id}")->assertOk();
    logAccessCall($this->member, $this->organization, 'GET', "/{$this->mine->id}/log-groups/{$group->id}")->assertOk();
    logAccessCall($this->member, $this->organization, 'GET', "/{$this->mine->id}/log-sources")->assertOk();
    logAccessCall($this->admin, $this->organization, 'GET', "/{$this->foreign->id}/log-groups")->assertOk();
    logAccessCall($this->admin, $this->organization, 'GET', "/{$this->foreign->id}/log-sources")->assertOk();
    logAccessCall($this->member, $this->organization, 'POST', "/{$this->mine->id}/tasks", [
        'title' => 'From alert', 'log_group_id' => $group->id,
    ])->assertCreated();
});
