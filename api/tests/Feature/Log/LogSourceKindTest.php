<?php

use App\Enums\LogSourceKind;
use App\Enums\Role;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->url = "/api/projects/{$this->project->id}/log-sources";
});

function createSourceAsAdmin(array $payload, string $locale = 'en')
{
    Sanctum::actingAs(test()->admin);

    return test()
        ->withHeaders(['X-Organization-Id' => (string) test()->organization->id, 'Accept-Language' => $locale])
        ->postJson(test()->url, $payload);
}

it('creates server sources by default with a wsk_ key and no origins', function () {
    $response = createSourceAsAdmin(['name' => 'api'])
        ->assertCreated()
        ->assertJsonPath('data.kind', 'server')
        ->assertJsonPath('data.allowed_origins', null);

    expect($response->json('data.key'))->toStartWith('wsk_')
        ->and($response->json('data.key_prefix'))->toStartWith('wsk_');

    $source = LogSource::withoutGlobalScopes()->firstOrFail();
    expect($source->kind)->toBe(LogSourceKind::Server)->and($source->allowed_origins)->toBeNull();
});

it('creates server sources with an explicit kind and an empty or null origin list', function (mixed $origins) {
    createSourceAsAdmin(['name' => 'api', 'kind' => 'server', 'allowed_origins' => $origins])
        ->assertCreated()
        ->assertJsonPath('data.kind', 'server')
        ->assertJsonPath('data.allowed_origins', null);
})->with([
    'empty list' => [[]],
    'null' => [null],
]);

it('creates browser sources with a wsp_ key and normalized origins', function () {
    $response = createSourceAsAdmin([
        'name' => 'spa',
        'kind' => 'browser',
        'allowed_origins' => [
            'HTTPS://App.Example.com',
            'https://app.example.com:443',
            'https://app.example.com:8443',
            'http://localhost:5173',
            'http://127.0.0.1',
        ],
    ])->assertCreated()->assertJsonPath('data.kind', 'browser');

    $expected = ['https://app.example.com', 'https://app.example.com:8443', 'http://localhost:5173', 'http://127.0.0.1'];

    expect($response->json('data.allowed_origins'))->toBe($expected)
        ->and($response->json('data.key'))->toMatch('/\Awsp_[A-Za-z0-9]{40}\z/')
        ->and($response->json('data.key_prefix'))->toBe(substr($response->json('data.key'), 0, 12));

    $source = LogSource::withoutGlobalScopes()->firstOrFail();
    expect($source->kind)->toBe(LogSourceKind::Browser)
        ->and($source->allowed_origins)->toBe($expected)
        ->and($source->key_hash)->toBe(LogSource::hashKey($response->json('data.key')));
});

it('accepts valid origins', function (string $origin) {
    createSourceAsAdmin(['name' => 'spa', 'kind' => 'browser', 'allowed_origins' => [$origin]])
        ->assertCreated()
        ->assertJsonPath('data.allowed_origins', [$origin]);
})->with([
    'https host' => 'https://app.example.com',
    'https with port' => 'https://app.example.com:8443',
    'https localhost' => 'https://localhost',
    'http localhost' => 'http://localhost',
    'http localhost with port' => 'http://localhost:5173',
    'http loopback with port' => 'http://127.0.0.1:8080',
]);

it('rejects invalid origins', function (string $origin) {
    createSourceAsAdmin(['name' => 'spa', 'kind' => 'browser', 'allowed_origins' => ['https://ok.example.com', $origin]])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('allowed_origins.1')
        ->assertJsonMissingValidationErrors('allowed_origins.0');

    expect(LogSource::withoutGlobalScopes()->count())->toBe(0);
})->with([
    'with path' => 'https://app.example.com/app',
    'with trailing slash' => 'https://app.example.com/',
    'with query' => 'https://app.example.com?x=1',
    'with fragment' => 'https://app.example.com#x',
    'with credentials' => 'https://user@app.example.com',
    'ftp scheme' => 'ftp://app.example.com',
    'websocket scheme' => 'wss://app.example.com',
    'without scheme' => 'app.example.com',
    'http not local' => 'http://app.example.com',
    'http lookalike of localhost' => 'http://localhost.example.com',
    'wildcard' => 'https://*.example.com',
    'port out of range' => 'https://app.example.com:70000',
    'port with leading zero' => 'https://app.example.com:0443',
    'empty' => '',
]);

it('explains invalid origins in the request language', function () {
    $response = createSourceAsAdmin(['name' => 'spa', 'kind' => 'browser', 'allowed_origins' => ['http://app.example.com']], 'es')
        ->assertUnprocessable();

    $key = 'Each allowed origin must be an exact origin like https://example.com, without path or trailing slash; plain http is only allowed for localhost and 127.0.0.1.';

    expect($response->json('errors')['allowed_origins.0'][0])->toBe(__($key, locale: 'es'))
        ->and(__($key, locale: 'es'))->not->toBe($key);
});

it('requires origins for browser sources', function (array $payload) {
    createSourceAsAdmin(['name' => 'spa', 'kind' => 'browser', ...$payload])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('allowed_origins');
})->with([
    'missing' => [[]],
    'empty list' => [['allowed_origins' => []]],
    'null' => [['allowed_origins' => null]],
    'not a list' => [['allowed_origins' => 'https://app.example.com']],
    'object' => [['allowed_origins' => ['a' => 'https://app.example.com']]],
]);

it('rejects origins for server sources', function (array $payload) {
    createSourceAsAdmin(['name' => 'api', ...$payload, 'allowed_origins' => ['https://app.example.com']])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('allowed_origins');
})->with([
    'default kind' => [[]],
    'explicit server' => [['kind' => 'server']],
]);

it('rejects unknown kinds', function () {
    createSourceAsAdmin(['name' => 'api', 'kind' => 'mobile'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('kind');
});

it('limits the number of origins', function () {
    $origins = array_map(fn (int $i) => "https://app{$i}.example.com", range(1, 21));

    createSourceAsAdmin(['name' => 'spa', 'kind' => 'browser', 'allowed_origins' => $origins])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('allowed_origins');
});

it('keeps the key prefix of the kind when rotating', function () {
    $browser = LogSource::factory()->for($this->project)->browser()->create();
    $server = LogSource::factory()->for($this->project)->create();

    Sanctum::actingAs($this->admin);
    $request = $this->withHeader('X-Organization-Id', (string) $this->organization->id);

    expect($request->postJson("{$this->url}/{$browser->id}/rotate-key")->assertOk()->json('data.key'))->toStartWith('wsp_')
        ->and($request->postJson("{$this->url}/{$server->id}/rotate-key")->assertOk()->json('data.key'))->toStartWith('wsk_')
        ->and($browser->fresh()->allowed_origins)->toBe(['https://app.example.com']);
});

it('enforces the kind and origins in the database', function (array $attributes) {
    $source = LogSource::factory()->for($this->project)->create();

    expect(fn () => DB::table('log_sources')->where('id', $source->id)->update($attributes))
        ->toThrow(QueryException::class);
})->with([
    'unknown kind' => [['kind' => 'mobile']],
    'server with origins' => [['allowed_origins' => '["https://app.example.com"]']],
    'browser without origins' => [['kind' => 'browser']],
    'browser with an empty list' => [['kind' => 'browser', 'allowed_origins' => '[]']],
]);

it('leaves existing sources as server sources when migrating', function () {
    $migration = require database_path('migrations/2026_10_15_100000_add_kind_and_allowed_origins_to_log_sources_table.php');
    $migration->down();

    $id = DB::table('log_sources')->insertGetId([
        'organization_id' => $this->organization->id,
        'project_id' => $this->project->id,
        'name' => 'legacy',
        'key_hash' => LogSource::hashKey($plainKey = LogSource::newPlainKey()),
        'key_prefix' => LogSource::displayPrefix($plainKey),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $migration->up();

    $row = DB::table('log_sources')->where('id', $id)->first();
    expect($row->kind)->toBe('server')->and($row->allowed_origins)->toBeNull();
});
