<?php

use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Laravel\Sanctum\Sanctum;

// Real concurrency needs committed data and two live connections, which RefreshDatabase's transaction cannot give.
// So the test switches the default connection to an unwrapped one (`conc_a`, the mover), uses `conc_b` as the
// competing writer, and removes everything it committed in `afterEach`. Roles are not seeded (they would collide
// with the seeded ones inside the wrapping transaction), so the policies are bypassed with `Gate::before`.
beforeEach(function () {
    $this->originalDefault = config('database.default');
    $this->concCreated = ['orgs' => [], 'users' => []];
    foreach (['conc_a', 'conc_b'] as $name) {
        config(["database.connections.{$name}" => config("database.connections.{$this->originalDefault}")]);
    }
    DB::setDefaultConnection('conc_a');
});

afterEach(function () {
    DB::setDefaultConnection($this->originalDefault);

    try {
        $writer = DB::connection('conc_b');
        while ($writer->transactionLevel() > 0) {
            $writer->rollBack();
        }
        $mover = DB::connection('conc_a');
        while ($mover->transactionLevel() > 0) {
            $mover->rollBack();
        }
        $mover->statement('RESET lock_timeout');
        $mover->table('organizations')->whereIn('id', $this->concCreated['orgs'])->delete();
        $mover->table('users')->whereIn('id', $this->concCreated['users'])->delete();
    } finally {
        DB::purge('conc_a');
        DB::purge('conc_b');
    }
});

function concurrentTask(Project $project, string $status, float $position): Task
{
    $task = new Task(['title' => 'Task', 'status' => $status, 'position' => $position]);
    $task->project_id = $project->id;
    $task->number = (int) DB::selectOne(
        'UPDATE projects SET last_task_number = last_task_number + 1 WHERE id = ? RETURNING last_task_number',
        [$project->id],
    )->last_task_number;
    $task->save();

    return $task;
}

function concurrentMove(Organization $organization, Project $project, Task $task, array $payload)
{
    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->postJson("/api/projects/{$project->id}/tasks/{$task->id}/move", $payload);
}

it('makes the move wait for the project lock and for the column rows held on another connection', function () {
    $organization = Organization::factory()->create();
    $user = User::factory()->create();
    $this->concCreated['orgs'][] = $organization->id;
    $this->concCreated['users'][] = $user->id;
    $organization->users()->attach($user->id);
    app(CurrentOrganization::class)->set($organization);

    $project = Project::factory()->for($organization)->create();
    $task = concurrentTask($project, 'todo', 1.0);
    $neighbor = concurrentTask($project, 'in_progress', 4.0);

    Gate::before(fn () => true);
    Sanctum::actingAs($user);
    $this->withoutExceptionHandling();
    $writer = DB::connection('conc_b');
    $payload = ['status' => 'in_progress', 'after_id' => $neighbor->id];

    // A concurrent store or move holds the project row; the mover must not read the column until it commits.
    // The lock timeout turns "waits" into an error the test can observe.
    foreach ([
        'project' => fn () => $writer->table('projects')->where('id', $project->id)->lock('for no key update')->first(),
        'column' => fn () => $writer->table('tasks')->where('id', $neighbor->id)->lock('for update')->first(),
    ] as $held => $lock) {
        $writer->beginTransaction();
        $lock();

        DB::statement("SET lock_timeout = '300ms'");
        try {
            concurrentMove($organization, $project, $task, $payload);
            $this->fail("The move should have waited for the {$held} lock.");
        } catch (QueryException $e) {
            expect($e->getCode())->toBe('55P03');
        } finally {
            DB::statement('RESET lock_timeout');
        }

        expect(DB::table('tasks')->where('id', $task->id)->value('status'))->toBe('todo');
        $writer->rollBack();
    }

    concurrentMove($organization, $project, $task, $payload)
        ->assertOk()
        ->assertJsonPath('data.status', 'in_progress')
        ->assertJsonPath('data.position', 5);
});

it('makes the move into done wait for the log group row that ingestion holds', function () {
    $organization = Organization::factory()->create();
    $user = User::factory()->create();
    $this->concCreated['orgs'][] = $organization->id;
    $this->concCreated['users'][] = $user->id;
    $organization->users()->attach($user->id);
    app(CurrentOrganization::class)->set($organization);

    $project = Project::factory()->for($organization)->create(['tasks_resolve_log_groups' => true]);
    $group = LogGroup::factory()->for($project)->create();
    $task = concurrentTask($project, 'in_review', 1.0);
    $task->log_group_id = $group->id;
    $task->save();

    Gate::before(fn () => true);
    Sanctum::actingAs($user);
    $this->withoutExceptionHandling();
    $writer = DB::connection('conc_b');

    // Ingestion's ON CONFLICT update holds the group row (NO KEY UPDATE) until it commits.
    $writer->beginTransaction();
    $writer->table('log_groups')->where('id', $group->id)->lock('for no key update')->first();

    DB::statement("SET lock_timeout = '300ms'");
    try {
        concurrentMove($organization, $project, $task, ['status' => 'done']);
        $this->fail('The move should have waited for the log group lock.');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('55P03');
    } finally {
        DB::statement('RESET lock_timeout');
    }

    expect(DB::table('tasks')->where('id', $task->id)->value('status'))->toBe('in_review')
        ->and(DB::table('log_groups')->where('id', $group->id)->value('status'))->toBe('open');
    $writer->rollBack();

    concurrentMove($organization, $project, $task, ['status' => 'done'])
        ->assertOk()
        ->assertJsonPath('data.log_group.status', 'resolved');
});
