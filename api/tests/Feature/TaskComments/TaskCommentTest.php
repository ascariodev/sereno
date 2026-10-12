<?php

use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

function commentTask(Project $project, int $number = 1): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = $number;
    $task->save();

    return $task;
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->task = commentTask($this->project);
});

it('stores a comment for a task and fills the organization', function () {
    $comment = $this->task->comments()->create(['body' => 'Looks good']);
    $comment->user_id = User::factory()->create()->id;
    $comment->save();
    $comment->refresh();

    expect($comment->organization_id)->toBe($this->organization->id)
        ->and($comment->task->is($this->task))->toBeTrue()
        ->and($this->task->comments()->count())->toBe(1);
});

it('builds comments with the factory', function () {
    $comment = TaskComment::factory()->forTask($this->task)->create();

    expect($comment->organization_id)->toBe($this->organization->id)
        ->and($comment->user)->toBeInstanceOf(User::class);
});

it('deletes the comments when the task is deleted', function () {
    TaskComment::factory()->count(2)->forTask($this->task)->create();
    $other = TaskComment::factory()->forTask(commentTask($this->project, 2))->create();

    $this->task->delete();

    expect(DB::table('task_comments')->count())->toBe(1)
        ->and(DB::table('task_comments')->value('id'))->toBe($other->id);
});

it('keeps the comment and clears the author when the user is deleted', function () {
    $comment = TaskComment::factory()->forTask($this->task)->create();

    $comment->user->delete();

    expect($comment->fresh()->user_id)->toBeNull();
});

it('rejects a comment whose organization differs from its task', function () {
    $other = Organization::factory()->create();

    DB::table('task_comments')->insert([
        'organization_id' => $other->id,
        'task_id' => $this->task->id,
        'body' => 'Cross tenant',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
})->throws(QueryException::class, 'task_comments_task_organization_fk');
