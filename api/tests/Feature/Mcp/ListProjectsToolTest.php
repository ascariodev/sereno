<?php

use App\Enums\LogLevel;
use App\Enums\Role;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\ListProjectsTool;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->owner = User::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
    $this->organization->addMember($this->member, [Role::Member]);

    $this->visible = Project::factory()->for($this->organization)->create(['name' => 'Alpha']);
    $this->hidden = Project::factory()->for($this->organization)->create(['name' => 'Beta']);
    $this->archived = Project::factory()->for($this->organization)->archived()->create(['name' => 'Gamma']);
    $this->visible->members()->attach($this->member->id, ['organization_id' => $this->organization->id]);
    $this->archived->members()->attach($this->member->id, ['organization_id' => $this->organization->id]);

    $this->otherOrganization = Organization::factory()->create();
    $this->foreign = Project::factory()->for($this->otherOrganization)->create(['name' => 'Foreign']);

    $this->call = function (User $user, array $arguments = [], ?Organization $organization = null) {
        app(CurrentOrganization::class)->set($organization ?? $this->organization);

        return SerenoServer::actingAs($user)->tool(ListProjectsTool::class, $arguments);
    };
});

it('lists every active project of the organization to an owner', function () {
    ($this->call)($this->owner)
        ->assertOk()
        ->assertSee(['Alpha', 'Beta'])
        ->assertDontSee(['Gamma', 'Foreign'])
        ->assertStructuredContent(fn ($json) => $json->has('data', 2)->etc());
});

it('lists only the assigned projects to a member', function () {
    ($this->call)($this->member)
        ->assertOk()
        ->assertSee('Alpha')
        ->assertDontSee(['Beta', 'Gamma', 'Foreign']);
});

it('includes archived projects only with the flag', function () {
    ($this->call)($this->owner, ['include_archived' => true])
        ->assertOk()
        ->assertSee(['Alpha', 'Beta', 'Gamma'])
        ->assertDontSee('Foreign');

    ($this->call)($this->member, ['include_archived' => true])
        ->assertOk()
        ->assertSee(['Alpha', 'Gamma'])
        ->assertDontSee('Beta');
});

it('returns an empty list when the user sees nothing', function () {
    $newcomer = User::factory()->create();
    $this->organization->addMember($newcomer, [Role::Member]);

    ($this->call)($newcomer)
        ->assertOk()
        ->assertStructuredContent(['data' => []]);
});

it('fails closed without an active organization', function () {
    app(CurrentOrganization::class)->set(null);

    SerenoServer::actingAs($this->owner)->tool(ListProjectsTool::class)
        ->assertHasErrors(['You do not belong to this organization.']);
});

it('returns an error to someone outside the organization', function () {
    $outsider = User::factory()->create();

    ($this->call)($outsider)
        ->assertHasErrors(['You are not allowed to do this.'])
        ->assertDontSee('Alpha');
});

it('validates include_archived', function () {
    ($this->call)($this->owner, ['include_archived' => 'maybe'])->assertHasErrors();
});

it('reports the open alert counters of each project', function () {
    LogGroup::factory()->create(['project_id' => $this->visible->id, 'level' => LogLevel::Critical]);
    LogGroup::factory()->resolved()->create(['project_id' => $this->visible->id]);

    ($this->call)($this->owner)
        ->assertOk()
        ->assertStructuredContent(fn ($json) => $json->has('data.0', fn ($project) => $project
            ->where('open_groups_count', 1)
            ->where('open_max_level', 'critical')
            ->etc())->etc());
});

it('registers the tool in the server', function () {
    SerenoServer::actingAs($this->owner)->tools()->assertRegistered(ListProjectsTool::class);
});
