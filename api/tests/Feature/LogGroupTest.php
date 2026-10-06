<?php

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
});

it('casts level and status to enums and fills the organization', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    $group->refresh();

    expect($group->level)->toBe(LogLevel::Error)
        ->and($group->status)->toBe(LogGroupStatus::Open)
        ->and($group->events_count)->toBe(1)
        ->and($group->organization_id)->toBe($this->organization->id);
});

it('rejects a duplicate fingerprint in the same project', function () {
    LogGroup::factory()->for($this->project)->create(['fingerprint' => 'abc']);

    LogGroup::factory()->for($this->project)->create(['fingerprint' => 'abc']);
})->throws(QueryException::class);

it('allows the same fingerprint in another project', function () {
    $otherProject = Project::factory()->for($this->organization)->create();
    LogGroup::factory()->for($this->project)->create(['fingerprint' => 'abc']);
    LogGroup::factory()->for($otherProject)->create(['fingerprint' => 'abc']);

    expect(LogGroup::query()->where('fingerprint', 'abc')->count())->toBe(2);
});

it('rejects an invalid level at the database', function () {
    $group = LogGroup::factory()->for($this->project)->create();

    DB::table('log_groups')->where('id', $group->id)->update(['level' => 'fatal']);
})->throws(QueryException::class, 'log_groups_level_check');

it('rejects an invalid status at the database', function () {
    $group = LogGroup::factory()->for($this->project)->create();

    DB::table('log_groups')->where('id', $group->id)->update(['status' => 'closed']);
})->throws(QueryException::class, 'log_groups_status_check');

it('orders levels by severity as in PSR-3', function () {
    $ordered = [
        LogLevel::Debug, LogLevel::Info, LogLevel::Notice, LogLevel::Warning,
        LogLevel::Error, LogLevel::Critical, LogLevel::Alert, LogLevel::Emergency,
    ];

    expect(LogLevel::cases())->toBe($ordered);

    foreach ($ordered as $i => $level) {
        expect($level->severity())->toBe($i);
        foreach ($ordered as $j => $other) {
            expect($level->isAtLeast($other))->toBe($i >= $j)
                ->and(LogLevel::highest($level, $other))->toBe($i >= $j ? $level : $other);
        }
    }
});

it('rejects a project from another organization', function () {
    $foreignProject = Project::factory()->for($this->other)->create();

    $group = new LogGroup([
        'fingerprint' => 'x', 'level' => LogLevel::Info, 'title' => 't',
        'first_seen_at' => now(), 'last_seen_at' => now(),
    ]);
    $group->project_id = $foreignProject->id;
    $group->save();
})->throws(InvalidArgumentException::class);

it('isolates groups between organizations', function () {
    $mine = LogGroup::factory()->for($this->project)->create();
    $foreign = LogGroup::factory()->for(Project::factory()->for($this->other)->create())->create();

    expect(LogGroup::query()->pluck('id')->all())->toBe([$mine->id])
        ->and(LogGroup::query()->find($foreign->id))->toBeNull();

    app(CurrentOrganization::class)->set($this->other);

    expect(LogGroup::query()->pluck('id')->all())->toBe([$foreign->id]);

    app(CurrentOrganization::class)->set(null);

    expect(LogGroup::query()->count())->toBe(0);
});
