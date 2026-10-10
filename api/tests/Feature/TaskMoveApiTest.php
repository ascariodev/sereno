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
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = columnTask($this->project, 'todo', 1.0);
});

function columnTask(Project $project, string $status, float $position): Task
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

function moveTaskAs(User $user, Organization $organization, Project $project, Task $task, array $payload)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->postJson("/api/projects/{$project->id}/tasks/{$task->id}/move", $payload);
}

/** Ids of a column in board order. */
function movedColumn(Project $project, string $status): array
{
    return Task::query()->where('project_id', $project->id)->where('status', $status)
        ->orderBy('position')->orderBy('id')->pluck('id')->all();
}

it('moves to the end of another column and returns the full resource', function () {
    $group = LogGroup::factory()->for($this->project)->create(['events_count' => 3]);
    $this->task->log_group_id = $group->id;
    $this->task->assignee_id = $this->member->id;
    $this->task->save();
    $first = columnTask($this->project, 'in_progress', 4.0);

    moveTaskAs($this->member, $this->organization, $this->project, $this->task, ['status' => 'in_progress'])
        ->assertOk()
        ->assertJsonPath('data.key', 'POSVE-1')
        ->assertJsonPath('data.status', 'in_progress')
        ->assertJsonPath('data.position', 5)
        ->assertJsonPath('data.assignee.id', $this->member->id)
        ->assertJsonPath('data.log_group.events_count', 3);

    expect(movedColumn($this->project, 'in_progress'))->toBe([$first->id, $this->task->id]);
});

it('places the task at 1 in an empty column', function () {
    moveTaskAs($this->member, $this->organization, $this->project, $this->task, ['status' => 'done'])
        ->assertOk()->assertJsonPath('data.position', 1);
});

it('places the task between, before or after its neighbors', function (string $neighbors, float $position, array $order) {
    $a = columnTask($this->project, 'in_review', 2.0);
    $b = columnTask($this->project, 'in_review', 4.0);
    $payload = ['status' => 'in_review'] + match ($neighbors) {
        'between' => ['after_id' => $a->id, 'before_id' => $b->id],
        'after a' => ['after_id' => $a->id],
        'before b' => ['before_id' => $b->id],
        'before a' => ['before_id' => $a->id],
        'after b' => ['after_id' => $b->id],
    };

    moveTaskAs($this->member, $this->organization, $this->project, $this->task, $payload)->assertOk();

    $ids = ['a' => $a->id, 'b' => $b->id, 't' => $this->task->id];
    expect($this->task->fresh()->position)->toEqual($position)
        ->and(movedColumn($this->project, 'in_review'))->toBe(array_map(fn ($key) => $ids[$key], $order));
})->with([
    'between' => ['between', 3.0, ['a', 't', 'b']],
    'after a' => ['after a', 3.0, ['a', 't', 'b']],
    'before b' => ['before b', 3.0, ['a', 't', 'b']],
    'before a' => ['before a', 1.0, ['t', 'a', 'b']],
    'after b' => ['after b', 5.0, ['a', 'b', 't']],
]);

it('reorders inside the same column ignoring the task own position', function () {
    $b = columnTask($this->project, 'todo', 2.0);
    $c = columnTask($this->project, 'todo', 3.0);

    moveTaskAs($this->member, $this->organization, $this->project, $this->task, [
        'status' => 'todo', 'after_id' => $b->id, 'before_id' => $c->id,
    ])->assertOk()->assertJsonPath('data.position', 2.5);
    expect(movedColumn($this->project, 'todo'))->toBe([$b->id, $this->task->id, $c->id]);

    // Moving to the end of its own column goes after the last other task, not after itself.
    moveTaskAs($this->member, $this->organization, $this->project, $this->task, ['status' => 'todo'])
        ->assertOk()->assertJsonPath('data.position', 4);
    expect(movedColumn($this->project, 'todo'))->toBe([$b->id, $c->id, $this->task->id]);
});

it('renumbers the column when the gap between neighbors is too small', function (float $gap) {
    $a = columnTask($this->project, 'done', 1.0);
    $b = columnTask($this->project, 'done', 1.0 + $gap);
    $c = columnTask($this->project, 'done', 7.5);

    moveTaskAs($this->member, $this->organization, $this->project, $this->task, [
        'status' => 'done', 'after_id' => $a->id, 'before_id' => $b->id,
    ])->assertOk()->assertJsonPath('data.position', 2);

    expect($a->fresh()->position)->toEqual(1.0)
        ->and($b->fresh()->position)->toEqual(3.0)
        ->and($c->fresh()->position)->toEqual(4.0)
        ->and(movedColumn($this->project, 'done'))->toBe([$a->id, $this->task->id, $b->id, $c->id]);
})->with([
    'tiny gap' => [1e-12],
    'tied positions' => [0.0],
]);

it('locks the project and the column rows', function () {
    $neighbor = columnTask($this->project, 'in_progress', 1.0);

    DB::flushQueryLog();
    DB::enableQueryLog();
    try {
        moveTaskAs($this->member, $this->organization, $this->project, $this->task, [
            'status' => 'in_progress', 'after_id' => $neighbor->id,
        ])->assertOk();
        $queries = collect(DB::getQueryLog())->pluck('query');
    } finally {
        DB::disableQueryLog();
    }

    expect($queries->contains(fn ($sql) => str_contains($sql, 'from "projects"') && str_ends_with($sql, 'for no key update')))->toBeTrue()
        ->and($queries->contains(fn ($sql) => str_contains($sql, 'from "tasks"') && str_contains($sql, '"status" = ?') && str_ends_with($sql, 'for update')))->toBeTrue();
});

it('rejects neighbors outside the target column, project or organization', function (string $case) {
    $neighbor = match ($case) {
        'other column' => columnTask($this->project, 'done', 1.0),
        'other project' => columnTask(Project::factory()->for($this->organization)->create(), 'in_progress', 1.0),
        'other organization' => (function () {
            app(CurrentOrganization::class)->set($this->other);
            $task = columnTask(Project::factory()->for($this->other)->create(), 'in_progress', 1.0);
            app(CurrentOrganization::class)->set($this->organization);

            return $task;
        })(),
        'missing' => (object) ['id' => 999999],
    };
    columnTask($this->project, 'in_progress', 1.0);

    foreach (['after_id', 'before_id'] as $field) {
        moveTaskAs($this->member, $this->organization, $this->project, $this->task, [
            'status' => 'in_progress', $field => $neighbor->id,
        ])->assertUnprocessable()
            ->assertJsonPath("errors.{$field}.0", 'The neighbor task is not in the target column of this project.');
    }
    expect($this->task->fresh()->status->value)->toBe('todo');
})->with(['other column', 'other project', 'other organization', 'missing']);

it('rejects the task as its own neighbor and the same neighbor on both sides', function () {
    $neighbor = columnTask($this->project, 'todo', 2.0);

    // The controller would also answer 422 on these fields (the task is not in its own column, and one task is
    // never next to itself), so the exact message proves which rule rejected the request.
    moveTaskAs($this->member, $this->organization, $this->project, $this->task, ['status' => 'todo', 'after_id' => $this->task->id])
        ->assertUnprocessable()
        ->assertJsonPath('errors.after_id.0', __('validation.not_in', ['attribute' => 'after id']));
    moveTaskAs($this->member, $this->organization, $this->project, $this->task, ['status' => 'todo', 'before_id' => $this->task->id])
        ->assertUnprocessable()
        ->assertJsonPath('errors.before_id.0', __('validation.not_in', ['attribute' => 'before id']));
    moveTaskAs($this->member, $this->organization, $this->project, $this->task, [
        'status' => 'todo', 'after_id' => $neighbor->id, 'before_id' => $neighbor->id,
    ])->assertUnprocessable()
        ->assertJsonPath('errors.before_id.0', __('validation.different', ['attribute' => 'before id', 'other' => 'after id']));

    expect($this->task->fresh()->position)->toEqual(1.0);
});

it('rejects neighbors that are not next to each other', function (string $order) {
    $a = columnTask($this->project, 'in_progress', 1.0);
    $middle = columnTask($this->project, 'in_progress', 2.0);
    $b = columnTask($this->project, 'in_progress', 3.0);
    $payload = $order === 'gap'
        ? ['after_id' => $a->id, 'before_id' => $b->id]
        : ['after_id' => $middle->id, 'before_id' => $a->id];

    moveTaskAs($this->member, $this->organization, $this->project, $this->task, ['status' => 'in_progress'] + $payload)
        ->assertUnprocessable()
        ->assertJsonPath('errors.before_id.0', 'The neighbor tasks are not next to each other.');
    expect($this->task->fresh()->status->value)->toBe('todo');
})->with(['gap', 'reversed']);

it('validates the status', function (array $payload) {
    moveTaskAs($this->member, $this->organization, $this->project, $this->task, $payload)
        ->assertUnprocessable()->assertJsonValidationErrors(['status']);
})->with([
    'missing' => [[]],
    'unknown' => [['status' => 'blocked']],
]);

it('answers 404 when the task belongs to another project', function () {
    $sibling = Project::factory()->for($this->organization)->create();

    moveTaskAs($this->member, $this->organization, $sibling, $this->task, ['status' => 'done'])->assertNotFound();
    expect($this->task->fresh()->status->value)->toBe('todo');
});

it('hides tasks of another organization before validating', function () {
    moveTaskAs($this->outsider, $this->other, $this->project, $this->task, ['status' => 'x'])->assertNotFound();
    moveTaskAs($this->outsider, $this->organization, $this->project, $this->task, ['status' => 'x'])->assertForbidden();
    expect($this->task->fresh()->status->value)->toBe('todo');
});

it('requires authentication', function () {
    $this->postJson("/api/projects/{$this->project->id}/tasks/{$this->task->id}/move", ['status' => 'done'])->assertUnauthorized();
});

it('rejects an archived project in the user language', function () {
    $this->project->forceFill(['archived_at' => now()])->save();
    $this->member->forceFill(['locale' => 'es'])->save();

    moveTaskAs($this->member, $this->organization, $this->project, $this->task, ['status' => 'done'])
        ->assertUnprocessable()
        ->assertJsonPath('errors.project.0', 'Este proyecto está archivado y sus tareas no se pueden mover.');
    expect($this->task->fresh()->status->value)->toBe('todo');
});
