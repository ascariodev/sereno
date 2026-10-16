<?php

use App\Enums\Role;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\ListProjectMembersTool;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->admin = User::factory()->create(['name' => 'Admin']);
    $this->member = User::factory()->create(['name' => 'Member']);
    $this->unassigned = User::factory()->create(['name' => 'Unassigned']);
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->organization->addMember($this->member, [Role::Member]);
    $this->organization->addMember($this->unassigned, [Role::Member]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->members()->attach([$this->member->id], ['organization_id' => $this->organization->id]);

    $this->call = function (User $user, array $arguments) {
        app(CurrentOrganization::class)->set($this->organization);

        return SerenoServer::actingAs($user)->tool(ListProjectMembersTool::class, $arguments);
    };
});

it('lists admins and assigned members with their email', function () {
    ($this->call)($this->member, ['project_id' => $this->project->id])
        ->assertOk()
        ->assertStructuredContent(fn ($json) => $json
            ->has('data', 2)
            ->where('data.0.name', 'Admin')
            ->where('data.0.role', 'admin')
            ->where('data.1.id', $this->member->id)
            ->where('data.1.email', $this->member->email)
            ->etc());
});

it('rejects a project the user cannot see', function () {
    ($this->call)($this->unassigned, ['project_id' => $this->project->id])->assertHasErrors();
});

it('rejects a missing project', function () {
    ($this->call)($this->member, ['project_id' => 999999])->assertHasErrors();
});
