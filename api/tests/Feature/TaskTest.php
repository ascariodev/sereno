<?php

use App\Enums\TaskStatus;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

function makeTask(Project $project, int $number, array $attributes = []): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0] + $attributes);
    $task->project_id = $project->id;
    $task->number = $number;
    $task->log_group_id = $attributes['log_group_id'] ?? null;
    $task->save();

    return $task;
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'POSVE']);
});

it('defaults to todo, casts the status and composes the key', function () {
    $task = makeTask($this->project, 14)->refresh();

    expect($task->status)->toBe(TaskStatus::Todo)
        ->and($task->organization_id)->toBe($this->organization->id)
        ->and($task->key())->toBe('POSVE-14')
        ->and($this->project->fresh()->last_task_number)->toBe(0);
});

it('orders the statuses as board columns', function () {
    expect(TaskStatus::cases())->toBe([TaskStatus::Todo, TaskStatus::InProgress, TaskStatus::InReview, TaskStatus::Done]);
});

it('rejects an invalid status at the database', function () {
    $task = makeTask($this->project, 1);

    DB::table('tasks')->where('id', $task->id)->update(['status' => 'blocked']);
})->throws(QueryException::class, 'tasks_status_check');

it('rejects a repeated number in the same project but not in another', function () {
    $otherProject = Project::factory()->for($this->organization)->create();
    makeTask($this->project, 1);
    makeTask($otherProject, 1);

    expect(Task::query()->count())->toBe(2);

    makeTask($this->project, 1);
})->throws(QueryException::class);

it('rejects two tasks for the same log group', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    makeTask($this->project, 1, ['log_group_id' => $group->id]);

    makeTask($this->project, 2, ['log_group_id' => $group->id]);
})->throws(QueryException::class);

it('allows many tasks without a log group', function () {
    makeTask($this->project, 1);
    makeTask($this->project, 2);

    expect(Task::query()->count())->toBe(2);
});

it('keeps the task with a null log group when the group is deleted', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    $task = makeTask($this->project, 1, ['log_group_id' => $group->id]);

    $group->delete();

    expect($task->fresh()->log_group_id)->toBeNull();
});

it('rejects a project from another organization', function () {
    $foreignProject = Project::factory()->for($this->other)->create();

    makeTask($foreignProject, 1);
})->throws(InvalidArgumentException::class);

it('does not let a project with tasks change organization', function () {
    makeTask($this->project, 1);

    $this->project->organization_id = $this->other->id;
    $this->project->save();
})->throws(InvalidArgumentException::class);
