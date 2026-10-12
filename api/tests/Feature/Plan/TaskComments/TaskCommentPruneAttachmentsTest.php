<?php

use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    Storage::fake('local');
    config(['chat.attachments.disk' => 'local', 'chat.attachments.orphan_hours' => 24]);
    $this->travelTo(now()->startOfSecond());
    $this->organization = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $project = Project::factory()->for($this->organization)->create();
    $this->task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $this->task->project_id = $project->id;
    $this->task->number = 1;
    $this->task->save();
    $this->comment = TaskComment::factory()->forTask($this->task)->create();
});

function pruneTaskAttachment(Task $task, string $age, ?TaskComment $comment = null): array
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
        'created_at' => now()->sub($age),
    ]);

    return [$id, $path];
}

it('deletes old unlinked comment attachments with their file and keeps the rest', function () {
    [$oldId, $oldPath] = pruneTaskAttachment($this->task, '25 hours');
    [$recentId, $recentPath] = pruneTaskAttachment($this->task, '23 hours');
    [$linkedId, $linkedPath] = pruneTaskAttachment($this->task, '3 days', $this->comment);

    $this->artisan('chat:prune-attachments')
        ->expectsOutputToContain('Deleted 1 orphan attachments and 0 stray files.')
        ->assertSuccessful();

    expect(DB::table('task_comment_attachments')->where('id', $oldId)->exists())->toBeFalse()
        ->and(Storage::disk('local')->exists($oldPath))->toBeFalse()
        ->and(DB::table('task_comment_attachments')->whereIn('id', [$recentId, $linkedId])->count())->toBe(2)
        ->and(Storage::disk('local')->exists($recentPath))->toBeTrue()
        ->and(Storage::disk('local')->exists($linkedPath))->toBeTrue();
});

it('sweeps old stray files under tasks but never one with a row', function () {
    [, $linkedPath] = pruneTaskAttachment($this->task, '3 days', $this->comment);
    [, $freshOrphanPath] = pruneTaskAttachment($this->task, '1 hour');
    $stray = "tasks/{$this->organization->id}/{$this->task->id}/stray";
    $freshStray = "tasks/{$this->organization->id}/{$this->task->id}/fresh";
    Storage::disk('local')->put($stray, 'x');
    Storage::disk('local')->put($freshStray, 'x');
    touch(Storage::disk('local')->path($stray), now()->subDays(3)->getTimestamp());

    $this->artisan('chat:prune-attachments')
        ->expectsOutputToContain('Deleted 0 orphan attachments and 1 stray files.')
        ->assertSuccessful();

    expect(Storage::disk('local')->exists($stray))->toBeFalse()
        ->and(Storage::disk('local')->exists($freshStray))->toBeTrue()
        ->and(Storage::disk('local')->exists($linkedPath))->toBeTrue()
        ->and(Storage::disk('local')->exists($freshOrphanPath))->toBeTrue();
});
