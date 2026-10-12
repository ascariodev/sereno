<?php

use App\Enums\Role;
use App\Events\TaskCommentDeleted;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
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
    $this->channel = "private-organizations.{$this->organization->id}.projects.{$this->project->id}";
});

function deleteComment(?User $user = null, ?int $taskId = null, ?int $commentId = null)
{
    Sanctum::actingAs($user ?? test()->author);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->deleteJson('/api/projects/'.test()->project->id.'/tasks/'.($taskId ?? test()->task->id).'/comments/'.($commentId ?? test()->comment->id));
}

function deleteCommentMember(Role $role): User
{
    $user = User::factory()->create();
    test()->organization->addMember($user, [$role]);
    test()->project->addMember($user);

    return $user;
}

/** @return array{0: int, 1: string} */
function deleteCommentAttachment(TaskComment $comment): array
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

function deleteCommentOtherTask(): Task
{
    $other = new Task(['title' => 'Other', 'position' => 2.0]);
    $other->project_id = test()->project->id;
    $other->number = 2;
    $other->save();

    return $other;
}

it('lets the author delete the comment with its mentions', function () {
    Event::fake([TaskCommentDeleted::class]);
    $ana = deleteCommentMember(Role::Member);
    DB::table('task_comment_mentions')->insert([
        'organization_id' => $this->organization->id,
        'task_comment_id' => $this->comment->id,
        'user_id' => $ana->id,
    ]);

    deleteComment()->assertNoContent();

    expect(DB::table('task_comments')->where('id', $this->comment->id)->exists())->toBeFalse()
        ->and(DB::table('task_comment_mentions')->where('task_comment_id', $this->comment->id)->exists())->toBeFalse();
});

it('lets an admin or owner delete a comment of someone else', function (Role $role) {
    Event::fake([TaskCommentDeleted::class]);

    deleteComment(deleteCommentMember($role))->assertNoContent();

    expect(DB::table('task_comments')->where('id', $this->comment->id)->exists())->toBeFalse();
})->with([
    'admin' => Role::Admin,
    'owner' => Role::Owner,
]);

it('forbids another member from deleting', function () {
    Event::fake([TaskCommentDeleted::class]);

    deleteComment(deleteCommentMember(Role::Member))->assertForbidden();

    expect(DB::table('task_comments')->where('id', $this->comment->id)->exists())->toBeTrue();
    Event::assertNotDispatched(TaskCommentDeleted::class);
});

it('returns 404 when the comment belongs to another task', function () {
    deleteComment(taskId: deleteCommentOtherTask()->id)->assertNotFound();

    expect(DB::table('task_comments')->where('id', $this->comment->id)->exists())->toBeTrue();
});

it('deletes the attachment rows and their files after the commit', function () {
    Event::fake([TaskCommentDeleted::class]);
    [$firstId, $firstPath] = deleteCommentAttachment($this->comment);
    [$secondId, $secondPath] = deleteCommentAttachment($this->comment);
    $other = TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->author->id]);
    [$keptId, $keptPath] = deleteCommentAttachment($other);

    deleteComment()->assertNoContent();

    expect(DB::table('task_comment_attachments')->whereIn('id', [$firstId, $secondId])->exists())->toBeFalse()
        ->and(DB::table('task_comment_attachments')->where('id', $keptId)->exists())->toBeTrue();
    Storage::disk('local')->assertMissing($firstPath);
    Storage::disk('local')->assertMissing($secondPath);
    Storage::disk('local')->assertExists($keptPath);
});

it('keeps the comment and its files when the transaction rolls back', function () {
    Event::fake([TaskCommentDeleted::class]);
    [$id, $path] = deleteCommentAttachment($this->comment);
    DB::unprepared(<<<'SQL'
        CREATE FUNCTION fail_task_comment_delete() RETURNS trigger AS $body$ BEGIN RAISE EXCEPTION 'boom'; END $body$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_task_comment_delete BEFORE DELETE ON task_comments FOR EACH ROW EXECUTE FUNCTION fail_task_comment_delete();
        SQL);

    deleteComment()->assertServerError();

    expect(DB::table('task_comments')->where('id', $this->comment->id)->exists())->toBeTrue()
        ->and(DB::table('task_comment_attachments')->where('id', $id)->exists())->toBeTrue();
    Storage::disk('local')->assertExists($path);
    Event::assertNotDispatched(TaskCommentDeleted::class);
});

it('broadcasts the deletion with the comment count after the commit', function () {
    Event::fake([TaskCommentDeleted::class]);
    TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->author->id]);
    TaskComment::factory()->forTask(deleteCommentOtherTask())->create(['user_id' => $this->author->id]);

    deleteComment()->assertNoContent();

    Event::assertDispatchedTimes(TaskCommentDeleted::class, 1);
    Event::assertDispatched(TaskCommentDeleted::class, fn (TaskCommentDeleted $event) => $event->broadcastOn()->name === $this->channel
        && $event->broadcastAs() === 'task.comment.deleted'
        && $event->broadcastWith() === ['id' => $this->comment->id, 'task_id' => $this->task->id, 'comments_count' => 1]);
});

it('returns 404 when the comment was already deleted', function () {
    Event::fake([TaskCommentDeleted::class]);

    deleteComment()->assertNoContent();
    deleteComment()->assertNotFound();

    Event::assertDispatchedTimes(TaskCommentDeleted::class, 1);
});
