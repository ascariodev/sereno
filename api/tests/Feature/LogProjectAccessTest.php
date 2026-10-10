<?php

use App\Enums\Role;
use App\Models\LogGroup;
use App\Models\LogSource;
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

it('hides updating a log group through the url of a foreign project', function () {
    logAccessCall($this->member, $this->organization, 'PATCH', "/{$this->foreign->id}/log-groups/{$this->mineGroup->id}", ['status' => 'resolved'])
        ->assertNotFound();

    expect($this->mineGroup->fresh()->status)->toBe($this->mineGroup->status);
});

it('forbids a member from creating, rotating or revoking log sources', function () {
    $source = LogSource::factory()->for($this->mine)->create();
    $keyHash = $source->key_hash;

    logAccessCall($this->member, $this->organization, 'POST', "/{$this->mine->id}/log-sources", ['name' => 'New source'])->assertForbidden();
    logAccessCall($this->member, $this->organization, 'POST', "/{$this->mine->id}/log-sources/{$source->id}/rotate-key")->assertForbidden();
    logAccessCall($this->member, $this->organization, 'DELETE', "/{$this->mine->id}/log-sources/{$source->id}")->assertForbidden();

    expect(LogSource::where('project_id', $this->mine->id)->count())->toBe(1)
        ->and($source->fresh()->key_hash)->toBe($keyHash)
        ->and($source->fresh()->revoked_at)->toBeNull();
});
