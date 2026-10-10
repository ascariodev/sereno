<?php

use App\Enums\Role;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'POSVE']);
});

function storeTaskAs(User $user, Organization $organization, Project $project, array $payload)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->postJson("/api/projects/{$project->id}/tasks", $payload);
}

function storedTasks(Project $project)
{
    app(CurrentOrganization::class)->set($project->organization);

    return Task::query()->where('project_id', $project->id)->orderBy('number')->get();
}

it('creates a task with the creator, the full resource and status 201', function () {
    $group = LogGroup::factory()->for($this->project)->create(['events_count' => 3]);

    $response = storeTaskAs($this->member, $this->organization, $this->project, [
        'title' => 'Fix the timeout',
        'description' => 'It happens at night.',
        'status' => 'in_progress',
        'assignee_id' => $this->member->id,
        'log_group_id' => $group->id,
    ])->assertCreated();

    $response->assertJsonPath('data.key', 'POSVE-1')
        ->assertJsonPath('data.number', 1)
        ->assertJsonPath('data.title', 'Fix the timeout')
        ->assertJsonPath('data.description', 'It happens at night.')
        ->assertJsonPath('data.status', 'in_progress')
        ->assertJsonPath('data.created_by', $this->member->id)
        ->assertJsonPath('data.assignee.id', $this->member->id)
        ->assertJsonPath('data.assignee.name', $this->member->name)
        ->assertJsonPath('data.log_group.id', $group->id)
        ->assertJsonPath('data.log_group.events_count', 3);

    $task = storedTasks($this->project)->sole();
    expect($task->organization_id)->toBe($this->organization->id)
        ->and($task->created_by)->toBe($this->member->id)
        ->and($task->log_group_id)->toBe($group->id);
});

it('defaults to todo without assignee nor log group', function () {
    storeTaskAs($this->member, $this->organization, $this->project, ['title' => 'Plain'])
        ->assertCreated()
        ->assertJsonPath('data.status', 'todo')
        ->assertJsonPath('data.description', null)
        ->assertJsonPath('data.assignee', null)
        ->assertJsonPath('data.log_group', null);
});

it('numbers tasks consecutively per project', function () {
    $sibling = Project::factory()->for($this->organization)->create();

    foreach (range(1, 3) as $expected) {
        storeTaskAs($this->member, $this->organization, $this->project, ['title' => "Task {$expected}"])
            ->assertCreated()
            ->assertJsonPath('data.number', $expected);
    }
    storeTaskAs($this->member, $this->organization, $sibling, ['title' => 'Other'])
        ->assertJsonPath('data.number', 1);

    expect(storedTasks($this->project)->pluck('number')->all())->toBe([1, 2, 3])
        ->and($this->project->fresh()->last_task_number)->toBe(3);
});

it('places the task at the end of its column', function () {
    $first = storeTaskAs($this->member, $this->organization, $this->project, ['title' => 'A'])->json('data.position');
    $second = storeTaskAs($this->member, $this->organization, $this->project, ['title' => 'B'])->json('data.position');
    $otherColumn = storeTaskAs($this->member, $this->organization, $this->project, [
        'title' => 'C', 'status' => 'done',
    ])->json('data.position');

    expect($second)->toBeGreaterThan($first)
        ->and($otherColumn)->toEqual(1.0);
});

it('rejects a log group that already has a task', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    storeTaskAs($this->member, $this->organization, $this->project, ['title' => 'A', 'log_group_id' => $group->id])
        ->assertCreated();

    DB::flushQueryLog();
    DB::enableQueryLog();
    storeTaskAs($this->member, $this->organization, $this->project, ['title' => 'B', 'log_group_id' => $group->id])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['log_group_id']);
    $queries = collect(DB::getQueryLog())->pluck('query');
    DB::disableQueryLog();

    // The request rule stops it before the transaction, not the unique index.
    expect($queries->filter(fn (string $query) => str_starts_with($query, 'UPDATE projects')))->toBeEmpty()
        ->and(storedTasks($this->project))->toHaveCount(1)
        ->and($this->project->fresh()->last_task_number)->toBe(1);
});

it('answers 422 when another request links the same log group first', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    $raced = false;

    $organizationId = $this->organization->id;

    Task::creating(function (Task $task) use (&$raced, $organizationId) {
        if ($raced) {
            return;
        }
        $raced = true;

        DB::table('tasks')->insert([
            'organization_id' => $organizationId,
            'project_id' => $task->project_id,
            'number' => 999,
            'title' => 'Concurrent',
            'status' => 'todo',
            'position' => 1.0,
            'log_group_id' => $task->log_group_id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    storeTaskAs($this->member, $this->organization, $this->project, ['title' => 'B', 'log_group_id' => $group->id])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['log_group_id']);

    expect($raced)->toBeTrue()
        ->and(storedTasks($this->project))->toHaveCount(0)
        ->and($this->project->fresh()->last_task_number)->toBe(0);
});

it('rejects a log group of another project or organization', function () {
    $sibling = Project::factory()->for($this->organization)->create();
    $siblingGroup = LogGroup::factory()->for($sibling)->create();
    $foreignProject = Project::factory()->for($this->other)->create();
    $foreignGroup = LogGroup::factory()->for($foreignProject)->create();

    foreach ([$siblingGroup, $foreignGroup] as $group) {
        storeTaskAs($this->member, $this->organization, $this->project, ['title' => 'A', 'log_group_id' => $group->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['log_group_id']);
    }
});

it('only assigns members of the organization', function () {
    storeTaskAs($this->member, $this->organization, $this->project, [
        'title' => 'A', 'assignee_id' => $this->outsider->id,
    ])->assertUnprocessable()->assertJsonValidationErrors(['assignee_id']);
});

it('validates title and status', function () {
    storeTaskAs($this->member, $this->organization, $this->project, [
        'title' => str_repeat('a', Task::TITLE_MAX_LENGTH + 1),
        'status' => 'blocked',
    ])->assertUnprocessable()->assertJsonValidationErrors(['title', 'status']);

    storeTaskAs($this->member, $this->organization, $this->project, [])
        ->assertUnprocessable()->assertJsonValidationErrors(['title']);
});

it('rejects an archived project in the user language', function () {
    $this->project->forceFill(['archived_at' => now()])->save();
    $this->member->forceFill(['locale' => 'es'])->save();

    storeTaskAs($this->member, $this->organization, $this->project, ['title' => 'A'])
        ->assertUnprocessable()
        ->assertJsonPath('errors.project.0', 'Este proyecto está archivado y no admite nuevas tareas.');

    expect(storedTasks($this->project))->toHaveCount(0);
});

it('hides the project from another organization before validating', function () {
    storeTaskAs($this->outsider, $this->other, $this->project, ['title' => 'A'])->assertNotFound();
    storeTaskAs($this->outsider, $this->organization, $this->project, ['assignee_id' => $this->member->id])
        ->assertForbidden();

    expect(storedTasks($this->project))->toHaveCount(0);
});

it('requires authentication', function () {
    $this->postJson("/api/projects/{$this->project->id}/tasks", ['title' => 'A'])->assertUnauthorized();
});
