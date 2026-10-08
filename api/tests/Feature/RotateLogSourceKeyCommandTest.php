<?php

use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Artisan;

beforeEach(function () {
    $this->organization = Organization::factory()->create(['slug' => 'acme']);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'DEMO']);
    [$this->source, $this->oldKey] = LogSource::issueFor($this->project, 'posveapi');
});

function rotatedKey(): string
{
    preg_match('/wsk_[A-Za-z0-9]{40}/', Artisan::output(), $matches);

    return $matches[0] ?? '';
}

function currentHash(LogSource $source): string
{
    return LogSource::query()->withoutGlobalScopes()->findOrFail($source->id)->key_hash;
}

function failureOutput(array $arguments): string
{
    expect(Artisan::call('log:source-rotate', $arguments))->toBe(1);

    return preg_replace('/\s+/', ' ', Artisan::output());
}

function ingest(object $test, string $key): int
{
    return $test->withToken($key)
        ->postJson('/api/ingest/events', ['events' => [['level' => 'error', 'message' => 'Boom']]])
        ->getStatusCode();
}

it('rotates the key by name: the new one ingests and the old one is rejected', function () {
    expect(Artisan::call('log:source-rotate', ['project' => 'demo', 'name' => 'posveapi']))->toBe(0);

    $newKey = rotatedKey();

    expect($newKey)->not->toBe('')->not->toBe($this->oldKey)
        ->and(ingest($this, $newKey))->toBe(202)
        ->and(ingest($this, $this->oldKey))->toBe(401);
});

it('rotates by id', function () {
    expect(Artisan::call('log:source-rotate', ['project' => 'DEMO', '--id' => (string) $this->source->id]))->toBe(0);

    expect(currentHash($this->source))->toBe(LogSource::hashKey(rotatedKey()));
});

it('requires exactly one of name and id', function () {
    expect(failureOutput(['project' => 'DEMO']))->toContain(__('Pass either the source name or --id.'));
    expect(failureOutput(['project' => 'DEMO', 'name' => 'posveapi', '--id' => (string) $this->source->id]))->toContain(__('Pass either the source name or --id.'));

    expect(currentHash($this->source))->toBe(LogSource::hashKey($this->oldKey));
});

it('fails for an unknown project without changing the key', function () {
    expect(failureOutput(['project' => 'NOPE', 'name' => 'posveapi']))->toContain(__('Project :project not found.', ['project' => 'NOPE']));

    expect(rotatedKey())->toBe('')
        ->and(currentHash($this->source))->toBe(LogSource::hashKey($this->oldKey));
});

it('fails for an unknown source without changing the key', function () {
    $message = __('Log source not found in project :project.', ['project' => 'DEMO']);

    expect(failureOutput(['project' => 'DEMO', 'name' => 'ghost']))->toContain($message);
    expect(failureOutput(['project' => 'DEMO', '--id' => '999999']))->toContain($message);
    expect(failureOutput(['project' => 'DEMO', '--id' => 'abc']))->toContain($message);

    expect(currentHash($this->source))->toBe(LogSource::hashKey($this->oldKey));
});

it('does not rotate a source of another project by id', function () {
    $other = Project::factory()->for($this->organization)->create(['key' => 'OTHER']);

    expect(failureOutput(['project' => 'OTHER', '--id' => (string) $this->source->id]))
        ->toContain(__('Log source not found in project :project.', ['project' => 'OTHER']));
    expect($other->id)->not->toBe($this->project->id)
        ->and(currentHash($this->source))->toBe(LogSource::hashKey($this->oldKey));
});

it('fails for a revoked source without changing the key', function () {
    $this->source->forceFill(['revoked_at' => now()])->save();

    expect(failureOutput(['project' => 'DEMO', 'name' => 'posveapi']))
        ->toContain(__('This log source is revoked and its key cannot be rotated.'));

    expect(rotatedKey())->toBe('')
        ->and(currentHash($this->source))->toBe(LogSource::hashKey($this->oldKey));
});

it('fails for an archived project without changing the key', function () {
    $this->project->forceFill(['archived_at' => now()])->save();

    expect(failureOutput(['project' => 'DEMO', 'name' => 'posveapi']))
        ->toContain(__('This project is archived and its log source keys cannot be rotated.'));

    expect(rotatedKey())->toBe('')
        ->and(currentHash($this->source))->toBe(LogSource::hashKey($this->oldKey));
});

it('asks for --id when several sources share the name, and rotates only that one', function () {
    [$twin, $twinKey] = LogSource::issueFor($this->project, 'posveapi');

    expect(failureOutput(['project' => 'DEMO', 'name' => 'posveapi']))
        ->toContain(__('Several log sources are named :name in project :project; pass --id with the source id.', ['name' => 'posveapi', 'project' => 'DEMO']));
    expect(currentHash($this->source))->toBe(LogSource::hashKey($this->oldKey))
        ->and(currentHash($twin))->toBe(LogSource::hashKey($twinKey));

    expect(Artisan::call('log:source-rotate', ['project' => 'DEMO', '--id' => (string) $twin->id]))->toBe(0);
    expect(currentHash($twin))->toBe(LogSource::hashKey(rotatedKey()))
        ->and(currentHash($this->source))->toBe(LogSource::hashKey($this->oldKey));
});

it('requires the organization when the project key is ambiguous', function () {
    $other = Organization::factory()->create(['slug' => 'other']);
    $otherProject = Project::factory()->for($other)->create(['key' => 'DEMO']);
    [$otherSource, $otherKey] = LogSource::issueFor($otherProject, 'posveapi');

    expect(failureOutput(['project' => 'DEMO', 'name' => 'posveapi']))
        ->toContain(__('Several projects match :project; pass --organization with the organization slug.', ['project' => 'DEMO']));
    expect(currentHash($otherSource))->toBe(LogSource::hashKey($otherKey));

    expect(Artisan::call('log:source-rotate', ['project' => 'DEMO', 'name' => 'posveapi', '--organization' => 'other']))->toBe(0);
    expect(currentHash($otherSource))->toBe(LogSource::hashKey(rotatedKey()))
        ->and(currentHash($this->source))->toBe(LogSource::hashKey($this->oldKey));
});

it('prints rejection messages in the active locale', function () {
    $english = failureOutput(['project' => 'DEMO', 'name' => 'ghost']);

    App::setLocale('es');
    $spanish = failureOutput(['project' => 'DEMO', 'name' => 'ghost']);

    expect($spanish)->toContain(__('Log source not found in project :project.', ['project' => 'DEMO']))
        ->not->toBe($english)
        ->not->toContain('Log source not found');
});
