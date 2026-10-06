<?php

use App\Enums\Role;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Gate;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();

    $this->users = [];
    foreach (Role::cases() as $role) {
        $user = User::factory()->create();
        $this->organization->addMember($user, [$role]);
        $this->users[$role->value] = $user;
    }

    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
});

it('generates keys with the wsk_ prefix and a display prefix', function () {
    $plain = LogSource::newPlainKey();

    expect($plain)->toStartWith('wsk_')
        ->and(strlen($plain))->toBe(44)
        ->and(LogSource::displayPrefix($plain))->toBe(substr($plain, 0, 12))
        ->and(LogSource::newPlainKey())->not->toBe($plain);
});

it('stores only the hash of the key and hides it', function () {
    $plain = LogSource::newPlainKey();
    $source = LogSource::factory()->for($this->project)->withPlainKey($plain)->create();

    expect($source->key_hash)->toBe(hash('sha256', $plain))
        ->and($source->key_prefix)->toBe(substr($plain, 0, 12))
        ->and($source->toArray())->not->toHaveKey('key_hash');
});

it('finds a source by plain key without an active organization', function () {
    $plain = LogSource::newPlainKey();
    $source = LogSource::factory()->for($this->project)->withPlainKey($plain)->create();
    app(CurrentOrganization::class)->set(null);

    expect(LogSource::findByPlainKey($plain)?->is($source))->toBeTrue()
        ->and(LogSource::findByPlainKey('wsk_unknown'))->toBeNull();
});

it('still finds a revoked source and reports it as revoked', function () {
    $plain = LogSource::newPlainKey();
    LogSource::factory()->for($this->project)->withPlainKey($plain)->revoked()->create();

    $found = LogSource::findByPlainKey($plain);

    expect($found)->not->toBeNull()
        ->and($found->isRevoked())->toBeTrue();
});

it('assigns the active organization on create', function () {
    $source = new LogSource(['name' => 'API', 'key_hash' => LogSource::hashKey('x'), 'key_prefix' => 'wsk_x']);
    $source->project_id = $this->project->id;
    $source->save();

    expect($source->organization_id)->toBe($this->organization->id);
});

it('rejects a project from another organization', function () {
    $foreign = Project::factory()->for($this->other)->create();

    LogSource::factory()->for($foreign)->create(['organization_id' => $this->organization->id]);
})->throws(InvalidArgumentException::class);

it('rejects a duplicate key hash', function () {
    LogSource::factory()->for($this->project)->withPlainKey('wsk_same')->create();
    LogSource::factory()->for($this->project)->withPlainKey('wsk_same')->create();
})->throws(QueryException::class);

it('deletes sources when the project is deleted', function () {
    LogSource::factory()->for($this->project)->create();
    $this->project->delete();

    expect(LogSource::query()->count())->toBe(0);
});

it('lets only owners and admins create and revoke', function (Role $role, bool $allowed) {
    $user = $this->users[$role->value];
    $source = LogSource::factory()->for($this->project)->create();

    expect(Gate::forUser($user)->allows('create', LogSource::class))->toBe($allowed)
        ->and(Gate::forUser($user)->allows('revoke', $source))->toBe($allowed);
})->with([
    'owner' => [Role::Owner, true],
    'admin' => [Role::Admin, true],
    'member' => [Role::Member, false],
]);

it('lets any member view', function (Role $role) {
    $user = $this->users[$role->value];
    $source = LogSource::factory()->for($this->project)->create();

    expect(Gate::forUser($user)->allows('viewAny', LogSource::class))->toBeTrue()
        ->and(Gate::forUser($user)->allows('view', $source))->toBeTrue();
})->with([Role::Owner, Role::Admin, Role::Member]);

it('denies a user with no role in the active organization', function () {
    $outsider = User::factory()->create();
    $source = LogSource::factory()->for($this->project)->create();

    expect(Gate::forUser($outsider)->allows('view', $source))->toBeFalse()
        ->and(Gate::forUser($outsider)->allows('create', LogSource::class))->toBeFalse();
});

it('isolates sources between organizations', function () {
    $mine = LogSource::factory()->for($this->project)->create();
    $foreignProject = Project::factory()->for($this->other)->create();
    $foreign = LogSource::factory()->for($foreignProject)->create();
    $owner = $this->users['owner'];

    expect(LogSource::query()->pluck('id')->all())->toBe([$mine->id])
        ->and(LogSource::query()->find($foreign->id))->toBeNull()
        ->and(Gate::forUser($owner)->allows('view', $foreign))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('revoke', $foreign))->toBeFalse();

    app(CurrentOrganization::class)->set($this->other);

    expect(LogSource::query()->pluck('id')->all())->toBe([$foreign->id]);
});

it('denies everything when there is no active organization', function () {
    $source = LogSource::factory()->for($this->project)->create();
    app(CurrentOrganization::class)->set(null);
    $owner = $this->users['owner'];

    expect(Gate::forUser($owner)->allows('viewAny', LogSource::class))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('create', LogSource::class))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('revoke', $source))->toBeFalse();
});
