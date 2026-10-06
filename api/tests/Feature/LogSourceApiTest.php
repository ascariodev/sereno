<?php

use App\Enums\Role;
use App\Models\LogSource;
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
});

function asSourceUser(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

it('creates a source and returns the plain key only once', function () {
    $response = asSourceUser($this->users['admin'], $this->organization)
        ->postJson("/api/projects/{$this->project->id}/log-sources", ['name' => 'posveapi'])
        ->assertCreated()
        ->assertJsonPath('data.name', 'posveapi')
        ->assertJsonMissingPath('data.key_hash');

    $key = $response->json('data.key');
    expect($key)->toStartWith('wsk_')->and($response->json('data.key_prefix'))->toBe(substr($key, 0, 12));

    $source = LogSource::withoutGlobalScopes()->firstOrFail();
    expect($source->key_hash)->toBe(LogSource::hashKey($key))
        ->and($source->organization_id)->toBe($this->organization->id);

    asSourceUser($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-sources")
        ->assertOk()
        ->assertJsonMissingPath('data.0.key')
        ->assertJsonMissing(['key' => $key]);
});

it('validates the name', function () {
    asSourceUser($this->users['owner'], $this->organization)
        ->postJson("/api/projects/{$this->project->id}/log-sources", [])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('name');
});

it('lists sources including revoked ones without exposing the key', function () {
    LogSource::factory()->for($this->project)->create(['name' => 'active']);
    LogSource::factory()->for($this->project)->revoked()->create(['name' => 'old']);
    LogSource::factory()->create();

    $response = asSourceUser($this->users['member'], $this->organization)
        ->getJson("/api/projects/{$this->project->id}/log-sources")
        ->assertOk()
        ->assertJsonCount(2, 'data');

    expect(collect($response->json('data'))->pluck('revoked_at')->filter()->count())->toBe(1)
        ->and($response->getContent())->not->toContain('key_hash');
});

it('revokes a source idempotently without deleting it', function () {
    $source = LogSource::factory()->for($this->project)->create();
    $url = "/api/projects/{$this->project->id}/log-sources/{$source->id}";

    $first = asSourceUser($this->users['admin'], $this->organization)->deleteJson($url)->assertOk();
    $revokedAt = $first->json('data.revoked_at');
    expect($revokedAt)->not->toBeNull();

    $this->travel(5)->minutes();
    asSourceUser($this->users['admin'], $this->organization)->deleteJson($url)
        ->assertOk()
        ->assertJsonPath('data.revoked_at', $revokedAt);

    expect(LogSource::withoutGlobalScopes()->count())->toBe(1);
});

it('forbids members from creating or revoking sources', function () {
    $source = LogSource::factory()->for($this->project)->create();

    asSourceUser($this->users['member'], $this->organization)
        ->postJson("/api/projects/{$this->project->id}/log-sources", ['name' => 'x'])
        ->assertForbidden();
    asSourceUser($this->users['member'], $this->organization)
        ->deleteJson("/api/projects/{$this->project->id}/log-sources/{$source->id}")
        ->assertForbidden();

    expect($source->fresh()->revoked_at)->toBeNull();
});

it('isolates sources between organizations', function () {
    $foreignProject = Project::factory()->for($this->other)->create();
    $foreignSource = LogSource::factory()->for($foreignProject)->create();
    $owner = $this->users['owner'];

    asSourceUser($owner, $this->organization)->getJson("/api/projects/{$foreignProject->id}/log-sources")->assertNotFound();
    asSourceUser($owner, $this->organization)->postJson("/api/projects/{$foreignProject->id}/log-sources", ['name' => 'x'])->assertNotFound();
    asSourceUser($owner, $this->organization)->deleteJson("/api/projects/{$foreignProject->id}/log-sources/{$foreignSource->id}")->assertNotFound();
    asSourceUser($owner, $this->organization)->deleteJson("/api/projects/{$this->project->id}/log-sources/{$foreignSource->id}")->assertNotFound();

    asSourceUser($owner, $this->other)->getJson("/api/projects/{$foreignProject->id}/log-sources")->assertForbidden();
    asSourceUser($owner, $this->other)->postJson("/api/projects/{$foreignProject->id}/log-sources", ['name' => 'x'])->assertForbidden();

    expect($foreignSource->fresh()->revoked_at)->toBeNull()
        ->and(LogSource::withoutGlobalScopes()->count())->toBe(1);
});

it('does not revoke a source through another project of the same organization', function () {
    $otherProject = Project::factory()->for($this->organization)->create();
    $source = LogSource::factory()->for($otherProject)->create();

    asSourceUser($this->users['owner'], $this->organization)
        ->deleteJson("/api/projects/{$this->project->id}/log-sources/{$source->id}")
        ->assertNotFound();
});

it('rejects creating sources in an archived project with a translated message', function () {
    $this->project->forceFill(['archived_at' => now()])->save();
    $url = "/api/projects/{$this->project->id}/log-sources";
    $key = 'This project is archived and cannot have new log sources.';

    asSourceUser($this->users['owner'], $this->organization)
        ->postJson($url, ['name' => 'x'])
        ->assertUnprocessable()
        ->assertJsonPath('errors.project.0', $key);

    asSourceUser($this->users['owner'], $this->organization)
        ->withHeader('Accept-Language', 'es')
        ->postJson($url, ['name' => 'x'])
        ->assertJsonPath('errors.project.0', __($key, [], 'es'));

    asSourceUser($this->users['member'], $this->organization)->postJson($url, ['name' => 'x'])->assertForbidden();
    expect(LogSource::withoutGlobalScopes()->count())->toBe(0);
});
