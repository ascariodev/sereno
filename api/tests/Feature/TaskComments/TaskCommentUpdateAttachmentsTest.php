<?php

use App\Enums\Role;
use App\Events\TaskCommentUpdated;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    Storage::fake('local');
    config(['chat.attachments.disk' => 'local']);
    $this->organization = Organization::factory()->create();
    $this->author = User::factory()->create();
    $this->organization->addMember($this->author, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->author);
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $this->task->project_id = $this->project->id;
    $this->task->number = 1;
    $this->task->save();
    $this->comment = TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->author->id, 'body' => 'Original']);
});

/** @return array{0: int, 1: string} */
function removeAttachmentTestFile(TaskComment $comment): array
{
    $path = "tasks/{$comment->organization_id}/{$comment->task_id}/".fake()->uuid();
    Storage::disk('local')->put($path, 'data');

    $id = DB::table('task_comment_attachments')->insertGetId([
        'organization_id' => $comment->organization_id,
        'task_id' => $comment->task_id,
        'task_comment_id' => $comment->id,
        'user_id' => $comment->user_id,
        'disk' => 'local',
        'path' => $path,
        'original_name' => 'a.txt',
        'mime' => 'text/plain',
        'size' => 4,
    ]);

    return [$id, $path];
}

function patchCommentAttachments(array $payload)
{
    Sanctum::actingAs(test()->author);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->patchJson('/api/projects/'.test()->project->id.'/tasks/'.test()->task->id.'/comments/'.test()->comment->id, $payload);
}

it('removes the attachment, deletes its file and marks the comment as edited', function () {
    Event::fake([TaskCommentUpdated::class]);
    [$removedId, $removedPath] = removeAttachmentTestFile($this->comment);
    [$keptId, $keptPath] = removeAttachmentTestFile($this->comment);

    patchCommentAttachments(['body' => 'Original', 'remove_attachment_ids' => [$removedId]])
        ->assertOk()
        ->assertJsonCount(1, 'data.attachments')
        ->assertJsonPath('data.attachments.0.id', $keptId)
        ->assertJsonPath('data.edited_at', fn ($value) => $value !== null);

    expect(DB::table('task_comment_attachments')->where('id', $removedId)->exists())->toBeFalse()
        ->and(DB::table('task_comments')->where('id', $this->comment->id)->value('edited_at'))->not->toBeNull();
    Storage::disk('local')->assertMissing($removedPath);
    Storage::disk('local')->assertExists($keptPath);
    Event::assertDispatched(TaskCommentUpdated::class);
});

it('rejects an attachment of another comment', function () {
    $other = TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->author->id]);
    [$otherId, $otherPath] = removeAttachmentTestFile($other);

    patchCommentAttachments(['body' => 'Changed', 'remove_attachment_ids' => [$otherId]])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('remove_attachment_ids.0');

    expect(DB::table('task_comment_attachments')->where('id', $otherId)->exists())->toBeTrue()
        ->and(DB::table('task_comments')->where('id', $this->comment->id)->value('body'))->toBe('Original');
    Storage::disk('local')->assertExists($otherPath);
});

it('keeps the attachment and its file when the transaction rolls back', function () {
    [$id, $path] = removeAttachmentTestFile($this->comment);
    Schema::drop('task_comment_mentions');

    patchCommentAttachments(['body' => 'Changed', 'remove_attachment_ids' => [$id]])->assertServerError();

    expect(DB::table('task_comment_attachments')->where('id', $id)->exists())->toBeTrue()
        ->and(DB::table('task_comments')->where('id', $this->comment->id)->value('edited_at'))->toBeNull();
    Storage::disk('local')->assertExists($path);
});
