<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();

    $this->users = [];
    foreach (Role::cases() as $role) {
        $user = User::factory()->create();
        $this->organization->addMember($user, [$role]);
        $this->users[$role->value] = $user;
    }

    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create();

    assignMembersToAllProjects();
});

function asChannelViewer(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

it('shows a channel with its project to every role, like the list', function () {
    foreach (Role::cases() as $role) {
        asChannelViewer($this->users[$role->value], $this->organization)
            ->getJson("/api/channels/{$this->channel->id}")
            ->assertOk()
            ->assertExactJson(['data' => [
                'id' => $this->channel->id,
                'project_id' => $this->project->id,
                'name' => $this->channel->name,
                'archived_at' => null,
                'created_at' => $this->channel->created_at->toJSON(),
                'project' => ['id' => $this->project->id, 'name' => $this->project->name, 'key' => $this->project->key],
            ]]);
    }
});

it('shows an archived channel', function () {
    $archived = Channel::factory()->for(Project::factory()->for($this->organization))->archived()->create();
    assignMembersToAllProjects();

    $response = asChannelViewer($this->users['member'], $this->organization)
        ->getJson("/api/channels/{$archived->id}")
        ->assertOk();

    expect($response->json('data.archived_at'))->not->toBeNull();
});

it('answers 404 for a channel of another organization or a missing one', function () {
    $foreign = Channel::factory()->for(Project::factory()->for($this->other))->create();

    asChannelViewer($this->users['owner'], $this->organization)->getJson("/api/channels/{$foreign->id}")->assertNotFound();
    asChannelViewer($this->outsider, $this->other)->getJson("/api/channels/{$this->channel->id}")->assertNotFound();
    asChannelViewer($this->users['owner'], $this->organization)->getJson('/api/channels/999999999')->assertNotFound();
});

it('answers 404 for a channel without project, which the list leaves out', function () {
    $general = Channel::factory()->create(['organization_id' => $this->organization->id, 'project_id' => null]);

    asChannelViewer($this->users['owner'], $this->organization)->getJson("/api/channels/{$general->id}")->assertNotFound();
});

it('answers every 404 like a missing channel, without revealing that it exists', function () {
    $foreign = Channel::factory()->for(Project::factory()->for($this->other))->create();
    $general = Channel::factory()->create(['organization_id' => $this->organization->id, 'project_id' => null]);
    $hidden = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $viewer = asChannelViewer($this->users['member'], $this->organization);
    $missing = $viewer->getJson('/api/channels/999999999')->assertNotFound()->json();

    foreach ([$foreign, $general, $hidden] as $channel) {
        expect($viewer->getJson("/api/channels/{$channel->id}")->assertNotFound()->json())->toBe($missing);
    }
});

it('returns the same item as the list', function () {
    $archived = Channel::factory()->for(Project::factory()->for($this->organization))->archived()->create();
    assignMembersToAllProjects();
    $viewer = asChannelViewer($this->users['member'], $this->organization);
    $list = collect($viewer->getJson('/api/channels?include_archived=1')->assertOk()->json('data'))->keyBy('id');

    foreach ([$this->channel, $archived] as $channel) {
        expect($viewer->getJson("/api/channels/{$channel->id}")->assertOk()->json('data'))->toBe($list[$channel->id]);
    }
});

it('answers 404 to a member on a channel of an unassigned project', function () {
    $hidden = Channel::factory()->for(Project::factory()->for($this->organization))->create();

    asChannelViewer($this->users['member'], $this->organization)->getJson("/api/channels/{$hidden->id}")->assertNotFound();
    asChannelViewer($this->users['admin'], $this->organization)->getJson("/api/channels/{$hidden->id}")->assertOk();
});

it('answers 403 with an organization the user does not belong to', function () {
    asChannelViewer($this->outsider, $this->organization)->getJson("/api/channels/{$this->channel->id}")->assertForbidden();
});

it('requires a token', function () {
    $this->getJson("/api/channels/{$this->channel->id}")->assertUnauthorized();
});
