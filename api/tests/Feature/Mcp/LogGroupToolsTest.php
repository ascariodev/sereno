<?php

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Enums\Role;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\GetLogGroupTool;
use App\Mcp\Tools\ListLogGroupsTool;
use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use App\Support\LogPartitions;
use Illuminate\Support\Carbon;

function mcpGroupEvent(LogGroup $group, string $message, ?Carbon $receivedAt = null): LogEvent
{
    $receivedAt ??= Carbon::now();
    LogPartitions::ensure($receivedAt);

    $event = new LogEvent([
        'level' => LogLevel::Error,
        'message' => $message,
        'context' => ['detail' => 'ctx-'.$message],
        'occurred_at' => $receivedAt,
        'received_at' => $receivedAt,
    ]);
    $event->organization_id = $group->organization_id;
    $event->project_id = $group->project_id;
    $event->log_group_id = $group->id;
    $event->save();

    return $event;
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->owner = User::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
    $this->organization->addMember($this->member, [Role::Member]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->otherProject = Project::factory()->for($this->organization)->create();
    $this->hiddenProject = Project::factory()->for($this->organization)->create();
    $this->project->members()->attach($this->member->id, ['organization_id' => $this->organization->id]);
    $this->otherProject->members()->attach($this->member->id, ['organization_id' => $this->organization->id]);

    $this->foreignProject = Project::factory()->for(Organization::factory()->create())->create();

    $this->call = function (string $tool, User $user, array $arguments = []) {
        app(CurrentOrganization::class)->set($this->organization);

        return SerenoServer::actingAs($user)->tool($tool, $arguments);
    };

    app(CurrentOrganization::class)->set($this->organization);
});

it('lists the groups of a project, most recent first', function () {
    LogGroup::factory()->for($this->project)->create(['title' => 'Older group', 'last_seen_at' => now()->subHour()]);
    LogGroup::factory()->for($this->project)->create(['title' => 'Newer group', 'last_seen_at' => now()]);
    LogGroup::factory()->for($this->otherProject)->create(['title' => 'Elsewhere group']);

    ($this->call)(ListLogGroupsTool::class, $this->member, ['project_id' => $this->project->id])
        ->assertOk()
        ->assertDontSee('Elsewhere group')
        ->assertStructuredContent(fn ($json) => $json
            ->has('data', 2)
            ->where('data.0.title', 'Newer group')
            ->where('data.1.title', 'Older group')
            ->where('meta.total', 2)
            ->where('meta.has_more', false)
            ->etc());
});

it('filters by status and by minimum level', function () {
    LogGroup::factory()->for($this->project)->create(['title' => 'Open error', 'level' => LogLevel::Error]);
    LogGroup::factory()->for($this->project)->create(['title' => 'Open warning', 'level' => LogLevel::Warning]);
    LogGroup::factory()->for($this->project)->create(['title' => 'Open critical', 'level' => LogLevel::Critical]);
    LogGroup::factory()->for($this->project)->resolved()->create(['title' => 'Resolved error']);

    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'status' => LogGroupStatus::Resolved->value])
        ->assertSee('Resolved error')
        ->assertDontSee(['Open error', 'Open warning', 'Open critical']);

    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'level' => LogLevel::Error->value])
        ->assertSee(['Open error', 'Open critical', 'Resolved error'])
        ->assertDontSee('Open warning');

    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'status' => 'open', 'level' => LogLevel::Critical->value])
        ->assertSee('Open critical')
        ->assertDontSee(['Open error', 'Resolved error']);
});

it('pages the groups', function () {
    LogGroup::factory()->for($this->project)->count(3)->create();

    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'per_page' => 2])
        ->assertStructuredContent(fn ($json) => $json->has('data', 2)->where('meta.has_more', true)->where('meta.total', 3)->etc());

    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'per_page' => 2, 'page' => 2])
        ->assertStructuredContent(fn ($json) => $json->has('data', 1)->where('meta.has_more', false)->etc());
});

it('validates the list filters', function () {
    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'status' => 'nope'])->assertHasErrors();
    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'level' => 'nope'])->assertHasErrors();
    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'per_page' => 101])->assertHasErrors();
    ($this->call)(ListLogGroupsTool::class, $this->owner, [])->assertHasErrors();
    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'page' => 0])->assertHasErrors();
    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->project->id, 'page' => 'abc'])->assertHasErrors();
});

it('answers not found when listing a project the user cannot see or from another organization', function () {
    LogGroup::factory()->for($this->hiddenProject)->create(['title' => 'Secret group']);

    ($this->call)(ListLogGroupsTool::class, $this->member, ['project_id' => $this->hiddenProject->id])
        ->assertHasErrors(['Not found.'])
        ->assertDontSee('Secret group');

    ($this->call)(ListLogGroupsTool::class, $this->owner, ['project_id' => $this->foreignProject->id])
        ->assertHasErrors(['Not found.']);
});

it('returns a group with its recent events', function () {
    $group = LogGroup::factory()->for($this->project)->create(['title' => 'Boom']);
    mcpGroupEvent($group, 'first');
    mcpGroupEvent($group, 'second');

    ($this->call)(GetLogGroupTool::class, $this->member, ['project_id' => $this->project->id, 'group_id' => $group->id])
        ->assertOk()
        ->assertSee(['Boom', 'ctx-first', 'ctx-second'])
        ->assertStructuredContent(fn ($json) => $json
            ->where('data.id', $group->id)
            ->has('data.events', 2)
            ->where('data.events.0.message', 'second')
            ->where('data.events.1.message', 'first')
            ->etc());
});

it('omits events older than the retention window and caps the events at 50', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    mcpGroupEvent($group, 'expired', now()->subDays(config('workspace.log.retention_days') + 2));
    foreach (range(1, 55) as $number) {
        mcpGroupEvent($group, 'event '.$number, now()->subMinutes(100 - $number));
    }

    ($this->call)(GetLogGroupTool::class, $this->owner, ['project_id' => $this->project->id, 'group_id' => $group->id])
        ->assertDontSee('expired')
        ->assertStructuredContent(fn ($json) => $json
            ->has('data.events', 50)
            ->where('data.events.0.message', 'event 55')
            ->where('data.events.49.message', 'event 6')
            ->etc());
});

it('answers not found for a group of another project, a hidden one or another organization', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    $hidden = LogGroup::factory()->for($this->hiddenProject)->create(['title' => 'Secret group']);
    mcpGroupEvent($hidden, 'secret event');

    ($this->call)(GetLogGroupTool::class, $this->owner, ['project_id' => $this->project->id, 'group_id' => $hidden->id])
        ->assertHasErrors(['Not found.'])
        ->assertDontSee(['Secret group', 'secret event']);

    ($this->call)(GetLogGroupTool::class, $this->member, ['project_id' => $this->hiddenProject->id, 'group_id' => $hidden->id])
        ->assertHasErrors(['Not found.'])
        ->assertDontSee(['Secret group', 'secret event']);

    ($this->call)(GetLogGroupTool::class, $this->owner, ['project_id' => $this->foreignProject->id, 'group_id' => $group->id])
        ->assertHasErrors(['Not found.']);

    ($this->call)(GetLogGroupTool::class, $this->owner, ['project_id' => $this->project->id, 'group_id' => 999999999])
        ->assertHasErrors(['Not found.']);
});

it('fails closed without an active organization', function () {
    app(CurrentOrganization::class)->set(null);

    SerenoServer::actingAs($this->owner)->tool(ListLogGroupsTool::class, ['project_id' => $this->project->id])
        ->assertHasErrors(['You do not belong to this organization.']);
    SerenoServer::actingAs($this->owner)->tool(GetLogGroupTool::class, ['project_id' => $this->project->id, 'group_id' => 1])
        ->assertHasErrors(['You do not belong to this organization.']);
});

it('registers both tools in the server', function () {
    SerenoServer::actingAs($this->owner)->tools()->assertRegistered([ListLogGroupsTool::class, GetLogGroupTool::class]);
});
