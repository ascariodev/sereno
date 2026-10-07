<?php

use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use Illuminate\Support\Facades\Artisan;

beforeEach(function () {
    $this->organization = Organization::factory()->create(['slug' => 'acme']);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'DEMO']);
});

function createdKey(): string
{
    preg_match('/wsk_[A-Za-z0-9]{40}/', Artisan::output(), $matches);

    return $matches[0] ?? '';
}

it('creates a source whose key authenticates the ingestion', function () {
    expect(Artisan::call('log:source-create', ['project' => 'demo', 'name' => 'posveapi']))->toBe(0);

    $key = createdKey();
    $source = LogSource::query()->withoutGlobalScopes()->where('project_id', $this->project->id)->sole();

    expect($key)->not->toBe('')
        ->and($source->name)->toBe('posveapi')
        ->and($source->organization_id)->toBe($this->organization->id)
        ->and($source->key_hash)->toBe(LogSource::hashKey($key));

    $this->withToken($key)
        ->postJson('/api/ingest/events', ['events' => [['level' => 'error', 'message' => 'Boom']]])
        ->assertStatus(202)
        ->assertJson(['accepted' => 1]);
});

it('fails for an archived project without creating anything', function () {
    $this->project->forceFill(['archived_at' => now()])->save();

    expect(Artisan::call('log:source-create', ['project' => 'DEMO', 'name' => 'posveapi']))->toBe(1);

    expect(LogSource::query()->withoutGlobalScopes()->count())->toBe(0)
        ->and(createdKey())->toBe('');
});

it('fails for an unknown project', function () {
    $this->artisan('log:source-create', ['project' => 'NOPE', 'name' => 'posveapi'])->assertFailed();

    expect(LogSource::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('rejects an invalid name without creating anything', function (string $name) {
    expect(Artisan::call('log:source-create', ['project' => 'DEMO', 'name' => $name]))->toBe(1);

    expect(LogSource::query()->withoutGlobalScopes()->count())->toBe(0)
        ->and(createdKey())->toBe('');
})->with([
    'empty' => '',
    'too long' => fn () => str_repeat('a', 256),
]);

it('fails for an unknown organization slug without creating anything', function () {
    expect(Artisan::call('log:source-create', ['project' => 'DEMO', 'name' => 'posveapi', '--organization' => 'ghost']))->toBe(1);
    expect(Artisan::output())->toContain('ghost');

    expect(LogSource::query()->withoutGlobalScopes()->count())->toBe(0)
        ->and(createdKey())->toBe('');
});

it('requires the organization when the key is ambiguous', function () {
    $other = Organization::factory()->create(['slug' => 'other']);
    Project::factory()->for($other)->create(['key' => 'DEMO']);

    expect(Artisan::call('log:source-create', ['project' => 'DEMO', 'name' => 'posveapi']))->toBe(1);
    expect(LogSource::query()->withoutGlobalScopes()->count())->toBe(0);

    $this->artisan('log:source-create', ['project' => 'DEMO', 'name' => 'posveapi', '--organization' => 'other'])->assertSuccessful();

    $source = LogSource::query()->withoutGlobalScopes()->sole();
    expect($source->organization_id)->toBe($other->id);
});
