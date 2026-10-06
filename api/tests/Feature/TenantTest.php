<?php

use App\Models\Concerns\BelongsToOrganization;
use App\Models\Organization;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;

class TenantTestRecord extends Model
{
    use BelongsToOrganization;

    protected $table = 'tenant_test_records';

    protected $guarded = [];
}

beforeEach(function () {
    Schema::create('tenant_test_records', function (Blueprint $table) {
        $table->id();
        $table->foreignId('organization_id')->constrained();
        $table->string('name');
        $table->timestamps();
    });

    Route::middleware(['api', 'auth:sanctum', 'organization'])
        ->get('/api/tenant-test', fn () => ['data' => TenantTestRecord::pluck('name')]);

    $this->own = Organization::factory()->create();
    $this->foreign = Organization::factory()->create();

    $this->user = User::factory()->create();
    $this->user->organizations()->attach($this->own);

    TenantTestRecord::withoutGlobalScopes()->create(['organization_id' => $this->own->id, 'name' => 'own']);
    TenantTestRecord::withoutGlobalScopes()->create(['organization_id' => $this->foreign->id, 'name' => 'foreign']);

    Sanctum::actingAs($this->user);
});

it('requires a numeric X-Organization-Id header', function (?string $value) {
    $request = $value === null ? $this : $this->withHeader('X-Organization-Id', $value);

    $request->getJson('/api/tenant-test')
        ->assertBadRequest()
        ->assertJsonPath('message', __('The :header header is missing or invalid.', ['header' => 'X-Organization-Id']));
})->with([
    'missing' => [null],
    'not numeric' => ['abc'],
]);

it('rejects an organization the user does not belong to', function (callable $id) {
    $this->withHeader('X-Organization-Id', (string) $id($this))
        ->getJson('/api/tenant-test')
        ->assertForbidden()
        ->assertJsonPath('message', __('You do not belong to this organization.'))
        ->assertJsonMissingPath('data');
})->with([
    'foreign' => [fn ($test) => $test->foreign->id],
    'nonexistent' => [fn () => 999999],
]);

it('returns only the records of the active organization', function () {
    $this->withHeader('X-Organization-Id', (string) $this->own->id)
        ->getJson('/api/tenant-test')
        ->assertOk()
        ->assertExactJson(['data' => ['own']]);
});

it('returns no rows without an active organization', function () {
    expect(TenantTestRecord::withoutGlobalScopes()->count())->toBe(2)
        ->and(TenantTestRecord::count())->toBe(0);
});

it('fills organization_id from the active organization on create', function () {
    app(CurrentOrganization::class)->set($this->own);

    $record = TenantTestRecord::create(['name' => 'new']);

    expect($record->organization_id)->toBe($this->own->id)
        ->and(TenantTestRecord::pluck('name')->all())->toEqualCanonicalizing(['own', 'new']);
});

it('responds 401 and clears the active organization when the route has no auth middleware', function () {
    Route::middleware(['api', 'organization'])->get('/api/tenant-test-guest', fn () => ['data' => []]);
    app('auth')->forgetGuards();
    app(CurrentOrganization::class)->set($this->own);

    $this->withHeader('X-Organization-Id', (string) $this->own->id)
        ->getJson('/api/tenant-test-guest')
        ->assertUnauthorized()
        ->assertJsonPath('message', __('Unauthenticated.'));

    expect(app(CurrentOrganization::class)->get())->toBeNull();
});
