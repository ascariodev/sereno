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
});

function asUser(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

it('creates a project with the key uppercased', function () {
    asUser($this->users['admin'], $this->organization)
        ->postJson('/api/projects', ['name' => 'Posven', 'key' => 'pos1', 'description' => 'POS'])
        ->assertCreated()
        ->assertJsonPath('data.key', 'POS1')
        ->assertJsonPath('data.archived_at', null);

    expect(Project::withoutGlobalScopes()->where('organization_id', $this->organization->id)->count())->toBe(1);
});

it('lets any member list and view but only owner and admin write', function (Role $role, bool $canWrite) {
    $project = Project::factory()->for($this->organization)->create();
    $user = $this->users[$role->value];

    asUser($user, $this->organization)->getJson('/api/projects')->assertOk()->assertJsonCount(1, 'data');
    asUser($user, $this->organization)->getJson("/api/projects/{$project->id}")->assertOk();

    asUser($user, $this->organization)->postJson('/api/projects', ['name' => 'X', 'key' => 'XYZ'])
        ->assertStatus($canWrite ? 201 : 403);
    asUser($user, $this->organization)->patchJson("/api/projects/{$project->id}", ['name' => 'Y'])
        ->assertStatus($canWrite ? 200 : 403);
    asUser($user, $this->organization)->postJson("/api/projects/{$project->id}/archive")
        ->assertStatus($canWrite ? 200 : 403);
})->with([
    'owner' => [Role::Owner, true],
    'admin' => [Role::Admin, true],
    'member' => [Role::Member, false],
]);

it('does not leak key existence to unauthorized members', function () {
    Project::factory()->for($this->organization)->create(['key' => 'TAKEN']);

    asUser($this->users['member'], $this->organization)
        ->postJson('/api/projects', ['name' => 'X', 'key' => 'taken'])
        ->assertForbidden();
});

it('rejects a repeated key in the same organization but allows it in another', function () {
    Project::factory()->for($this->organization)->create(['key' => 'APP']);

    asUser($this->users['owner'], $this->organization)
        ->postJson('/api/projects', ['name' => 'Dup', 'key' => 'app'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['key']);

    asUser($this->outsider, $this->other)
        ->postJson('/api/projects', ['name' => 'Other', 'key' => 'APP'])
        ->assertCreated();
});

it('rejects an invalid key format', function () {
    asUser($this->users['owner'], $this->organization)
        ->postJson('/api/projects', ['name' => 'X', 'key' => '1A'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['key']);
});

it('translates the duplicate key message', function () {
    Project::factory()->for($this->organization)->create(['key' => 'APP']);

    asUser($this->users['owner'], $this->organization)
        ->withHeader('Accept-Language', 'es')
        ->postJson('/api/projects', ['name' => 'Dup', 'key' => 'APP'])
        ->assertJsonPath('errors.key.0', __('A project with this key already exists in the organization.', [], 'es'));
});

it('lets a project keep its own key on update but not take another', function () {
    $project = Project::factory()->for($this->organization)->create(['key' => 'AAA']);
    Project::factory()->for($this->organization)->create(['key' => 'BBB']);

    asUser($this->users['owner'], $this->organization)
        ->patchJson("/api/projects/{$project->id}", ['key' => 'aaa', 'name' => 'Renamed'])
        ->assertOk()
        ->assertJsonPath('data.name', 'Renamed');

    asUser($this->users['owner'], $this->organization)
        ->patchJson("/api/projects/{$project->id}", ['key' => 'BBB'])
        ->assertUnprocessable();
});

it('ignores archived_at in create and update requests', function () {
    $project = Project::factory()->for($this->organization)->create();

    asUser($this->users['owner'], $this->organization)
        ->postJson('/api/projects', ['name' => 'X', 'key' => 'XYZ', 'archived_at' => now()->toISOString()])
        ->assertCreated()
        ->assertJsonPath('data.archived_at', null);

    asUser($this->users['owner'], $this->organization)
        ->patchJson("/api/projects/{$project->id}", ['archived_at' => now()->toISOString()])
        ->assertOk()
        ->assertJsonPath('data.archived_at', null);
});

it('archives and unarchives, hiding archived projects unless requested', function () {
    $project = Project::factory()->for($this->organization)->create();
    $owner = $this->users['owner'];

    asUser($owner, $this->organization)->postJson("/api/projects/{$project->id}/archive")
        ->assertOk()->assertJsonPath('data.archived_at', fn ($value) => $value !== null);

    asUser($owner, $this->organization)->getJson('/api/projects')->assertJsonCount(0, 'data');
    asUser($owner, $this->organization)->getJson('/api/projects?include_archived=1')->assertJsonCount(1, 'data');

    asUser($owner, $this->organization)->deleteJson("/api/projects/{$project->id}/archive")
        ->assertOk()->assertJsonPath('data.archived_at', null);

    asUser($owner, $this->organization)->getJson('/api/projects')->assertJsonCount(1, 'data');
});

it('has no physical delete route', function () {
    $project = Project::factory()->for($this->organization)->create();

    asUser($this->users['owner'], $this->organization)->deleteJson("/api/projects/{$project->id}")->assertStatus(405);
    expect(Project::withoutGlobalScopes()->count())->toBe(1);
});

it('isolates projects between organizations', function () {
    $foreign = Project::factory()->for($this->other)->create(['key' => 'FOR']);
    $owner = $this->users['owner'];

    asUser($owner, $this->organization)->getJson('/api/projects?include_archived=1')->assertJsonCount(0, 'data');
    asUser($owner, $this->organization)->getJson("/api/projects/{$foreign->id}")->assertNotFound();
    asUser($owner, $this->organization)->patchJson("/api/projects/{$foreign->id}", ['name' => 'Hack'])->assertNotFound();
    asUser($owner, $this->organization)->postJson("/api/projects/{$foreign->id}/archive")->assertNotFound();
    asUser($owner, $this->organization)->deleteJson("/api/projects/{$foreign->id}/archive")->assertNotFound();

    asUser($owner, $this->other)->getJson('/api/projects')->assertForbidden();
    asUser($owner, $this->other)->postJson('/api/projects', ['name' => 'X', 'key' => 'XYZ'])->assertForbidden();

    $foreign = Project::withoutGlobalScopes()->findOrFail($foreign->id);
    expect($foreign->name)->not->toBe('Hack')->and($foreign->archived_at)->toBeNull();
});

it('requires authentication and the organization header', function () {
    $this->getJson('/api/projects')->assertUnauthorized();

    Sanctum::actingAs($this->users['owner']);
    $this->getJson('/api/projects')->assertStatus(400);
});

it('paginates the project list with data, links and meta', function () {
    Project::factory()->for($this->organization)->count(30)->sequence(fn ($sequence) => [
        'name' => sprintf('Project %02d', $sequence->index),
        'key' => sprintf('P%02d', $sequence->index),
    ])->create();
    $member = $this->users['member'];

    asUser($member, $this->organization)->getJson('/api/projects')
        ->assertOk()
        ->assertJsonStructure(['data', 'links' => ['first', 'last', 'prev', 'next'], 'meta' => ['current_page', 'per_page', 'total', 'last_page']])
        ->assertJsonCount(25, 'data')
        ->assertJsonPath('meta.per_page', 25)
        ->assertJsonPath('meta.total', 30)
        ->assertJsonPath('data.0.name', 'Project 00');

    asUser($member, $this->organization)->getJson('/api/projects?per_page=10&page=3')
        ->assertOk()
        ->assertJsonCount(10, 'data')
        ->assertJsonPath('meta.per_page', 10)
        ->assertJsonPath('meta.current_page', 3)
        ->assertJsonPath('data.0.name', 'Project 20');

    asUser($member, $this->organization)->getJson('/api/projects?per_page=100')
        ->assertOk()->assertJsonCount(30, 'data');
});

it('rejects an invalid per_page with 422', function (string $query) {
    asUser($this->users['member'], $this->organization)->getJson("/api/projects?{$query}")
        ->assertUnprocessable()->assertJsonValidationErrors('per_page');
})->with([
    'over the maximum' => 'per_page=101',
    'zero' => 'per_page=0',
    'text' => 'per_page=abc',
    'array' => 'per_page[]=10',
]);

it('keeps include_archived in the pagination links and counts archived projects', function () {
    Project::factory()->for($this->organization)->count(3)->sequence(
        ['key' => 'AAA', 'archived_at' => now()],
        ['key' => 'BBB', 'archived_at' => now()],
        ['key' => 'CCC'],
    )->create();
    $member = $this->users['member'];

    asUser($member, $this->organization)->getJson('/api/projects?per_page=1')
        ->assertJsonPath('meta.total', 1);

    asUser($member, $this->organization)->getJson('/api/projects?include_archived=1&per_page=1')
        ->assertJsonPath('meta.total', 3)
        ->assertJsonPath('links.next', fn ($url) => str_contains($url, 'include_archived=1') && str_contains($url, 'per_page=1'));
});

it('creates the project channel named after the key', function () {
    asUser($this->users['admin'], $this->organization)
        ->postJson('/api/projects', ['name' => 'Posven', 'key' => 'pos1'])
        ->assertCreated();

    $project = Project::withoutGlobalScopes()->where('organization_id', $this->organization->id)->firstOrFail();
    $channel = $project->channel()->withoutGlobalScopes()->firstOrFail();

    expect($channel->name)->toBe('POS1')
        ->and($channel->organization_id)->toBe($this->organization->id);
});

it('creates no project nor channel when the channel fails', function () {
    Channel::creating(fn () => throw new RuntimeException('boom'));

    $thrown = null;

    try {
        asUser($this->users['admin'], $this->organization)
            ->withoutExceptionHandling()
            ->postJson('/api/projects', ['name' => 'Posven', 'key' => 'pos1']);
    } catch (RuntimeException $e) {
        $thrown = $e;
    }

    expect($thrown)->toBeInstanceOf(RuntimeException::class)
        ->and(Project::withoutGlobalScopes()->count())->toBe(0)
        ->and(Channel::withoutGlobalScopes()->count())->toBe(0);
});

it('backfills channels for existing projects idempotently', function () {
    $a = Project::factory()->create(['organization_id' => $this->organization->id, 'key' => 'AAA']);
    $b = Project::factory()->create(['organization_id' => $this->other->id, 'key' => 'BBB']);
    Channel::factory()->create(['project_id' => $b->id, 'name' => 'custom']);

    $migration = require database_path('migrations/2026_10_07_110000_backfill_project_channels.php');
    $migration->up();
    $migration->up();

    $channels = Channel::withoutGlobalScopes()->orderBy('project_id')->get();
    expect($channels)->toHaveCount(2)
        ->and($channels->firstWhere('project_id', $a->id)->name)->toBe('AAA')
        ->and($channels->firstWhere('project_id', $a->id)->organization_id)->toBe($this->organization->id)
        ->and($channels->firstWhere('project_id', $b->id)->name)->toBe('custom');
});

it('archives and unarchives the project channel with the project', function () {
    $project = Project::factory()->for($this->organization)->create();
    $channel = Channel::factory()->for($project)->create();
    $owner = $this->users['owner'];

    asUser($owner, $this->organization)->postJson("/api/projects/{$project->id}/archive")->assertOk();

    $archivedAt = $channel->fresh()->archived_at;
    expect($archivedAt)->not->toBeNull()
        ->and($archivedAt->equalTo($project->fresh()->archived_at))->toBeTrue();
    asUser($owner, $this->organization)->getJson('/api/channels')->assertJsonCount(0, 'data');
    asUser($owner, $this->organization)
        ->postJson("/api/channels/{$channel->id}/messages", ['body' => 'hi'])
        ->assertUnprocessable()->assertJsonValidationErrors('channel');

    $this->travel(5)->minutes();
    asUser($owner, $this->organization)->postJson("/api/projects/{$project->id}/archive")->assertOk();
    expect($channel->fresh()->archived_at->equalTo($archivedAt))->toBeTrue();

    asUser($owner, $this->organization)->deleteJson("/api/projects/{$project->id}/archive")->assertOk();

    expect($channel->fresh()->archived_at)->toBeNull();
    asUser($owner, $this->organization)->getJson('/api/channels')->assertJsonCount(1, 'data');
    asUser($owner, $this->organization)
        ->postJson("/api/channels/{$channel->id}/messages", ['body' => 'hi'])
        ->assertCreated();
});

it('syncs the channel archived_at with its archived project idempotently', function () {
    $archivedAt = now()->subDay()->startOfSecond();
    $archived = Project::factory()->for($this->organization)->create(['archived_at' => $archivedAt]);
    $active = Project::factory()->for($this->organization)->create();
    $already = Project::factory()->for($this->organization)->create(['archived_at' => now()]);
    $custom = now()->subWeek()->startOfSecond();
    $channelArchived = Channel::factory()->for($archived)->create();
    $channelActive = Channel::factory()->for($active)->create();
    $channelAlready = Channel::factory()->for($already)->create(['archived_at' => $custom]);

    $migration = require database_path('migrations/2026_10_07_130000_sync_project_channels_archived_at.php');
    $migration->up();
    $migration->up();

    expect($channelArchived->fresh()->archived_at->equalTo($archivedAt))->toBeTrue()
        ->and($channelActive->fresh()->archived_at)->toBeNull()
        ->and($channelAlready->fresh()->archived_at->equalTo($custom))->toBeTrue();
});
