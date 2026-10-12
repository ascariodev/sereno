<?php

use App\Actions\DeleteTask;
use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    Storage::fake('local');
    config(['chat.attachments.disk' => 'local']);
    $this->organization = Organization::factory()->create();
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->admin);
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = deleteFilesTestTask($this->project, 1);
    $this->otherTask = deleteFilesTestTask($this->project, 2);
});

function deleteFilesTestTask(Project $project, int $number): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = $number;
    $task->save();

    return $task;
}

/** @return array{0: int, 1: string} */
function deleteFilesTestAttachment(Task $task, ?TaskComment $comment = null): array
{
    $path = "tasks/{$task->organization_id}/{$task->id}/".fake()->uuid();
    Storage::disk('local')->put($path, 'data');

    $id = DB::table('task_comment_attachments')->insertGetId([
        'organization_id' => $task->organization_id,
        'task_id' => $task->id,
        'task_comment_id' => $comment?->id,
        'disk' => 'local',
        'path' => $path,
        'original_name' => 'a.txt',
        'mime' => 'text/plain',
        'size' => 4,
    ]);

    return [$id, $path];
}

function deleteFilesTestRequest(Task $task)
{
    Sanctum::actingAs(test()->admin);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->deleteJson("/api/projects/{$task->project_id}/tasks/{$task->id}");
}

it('deletes the comment attachment files and the task directory after deleting the task', function () {
    $comment = TaskComment::factory()->forTask($this->task)->create();
    [$linkedId, $linkedPath] = deleteFilesTestAttachment($this->task, $comment);
    [$unlinkedId, $unlinkedPath] = deleteFilesTestAttachment($this->task);
    $stray = "tasks/{$this->organization->id}/{$this->task->id}/stray";
    Storage::disk('local')->put($stray, 'x');

    deleteFilesTestRequest($this->task)->assertNoContent();

    expect(Task::withoutGlobalScopes()->whereKey($this->task->id)->exists())->toBeFalse()
        ->and(DB::table('task_comment_attachments')->whereIn('id', [$linkedId, $unlinkedId])->exists())->toBeFalse();
    Storage::disk('local')->assertMissing($linkedPath);
    Storage::disk('local')->assertMissing($unlinkedPath);
    Storage::disk('local')->assertMissing($stray);
    Storage::disk('local')->assertDirectoryEmpty("tasks/{$this->organization->id}");
});

it('keeps the files of other tasks', function () {
    $otherComment = TaskComment::factory()->forTask($this->otherTask)->create();
    [$otherLinkedId, $otherLinkedPath] = deleteFilesTestAttachment($this->otherTask, $otherComment);
    [$otherUnlinkedId, $otherUnlinkedPath] = deleteFilesTestAttachment($this->otherTask);
    [, $ownPath] = deleteFilesTestAttachment($this->task);

    deleteFilesTestRequest($this->task)->assertNoContent();

    Storage::disk('local')->assertMissing($ownPath);
    Storage::disk('local')->assertExists($otherLinkedPath);
    Storage::disk('local')->assertExists($otherUnlinkedPath);
    expect(DB::table('task_comment_attachments')->whereIn('id', [$otherLinkedId, $otherUnlinkedId])->count())->toBe(2);
});

it('keeps the files when the transaction rolls back', function () {
    $comment = TaskComment::factory()->forTask($this->task)->create();
    [$linkedId, $linkedPath] = deleteFilesTestAttachment($this->task, $comment);
    [, $unlinkedPath] = deleteFilesTestAttachment($this->task);

    try {
        DB::transaction(function () {
            app(DeleteTask::class)($this->task);

            throw new RuntimeException('rollback');
        });
    } catch (RuntimeException) {
    }

    expect(Task::withoutGlobalScopes()->whereKey($this->task->id)->exists())->toBeTrue()
        ->and(DB::table('task_comment_attachments')->where('id', $linkedId)->exists())->toBeTrue();
    Storage::disk('local')->assertExists($linkedPath);
    Storage::disk('local')->assertExists($unlinkedPath);
});

it('does nothing when the task is already gone', function () {
    [, $otherPath] = deleteFilesTestAttachment($this->otherTask);
    $gone = Task::query()->findOrFail($this->task->id);
    DB::table('tasks')->where('id', $this->task->id)->delete();

    app(DeleteTask::class)($gone);

    Storage::disk('local')->assertExists($otherPath);
});
