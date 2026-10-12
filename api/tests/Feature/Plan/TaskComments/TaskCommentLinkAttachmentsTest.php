<?php

use App\Enums\Role;
use App\Events\TaskCommentCreated;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->author = User::factory()->create();
    $this->organization->addMember($this->author, [Role::Member]);
    $this->colleague = User::factory()->create();
    $this->organization->addMember($this->colleague, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->author);
    $this->project->addMember($this->colleague);
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = linkTestTask($this->project, 1);
    $this->otherTask = linkTestTask($this->project, 2);
});

function linkTestTask(Project $project, int $number): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = $number;
    $task->save();

    return $task;
}

function linkTestAttachment(Task $task, User $uploader, ?TaskComment $comment = null): int
{
    return DB::table('task_comment_attachments')->insertGetId([
        'organization_id' => $task->organization_id,
        'task_id' => $task->id,
        'task_comment_id' => $comment?->id,
        'user_id' => $uploader->id,
        'disk' => 'local',
        'path' => "tasks/{$task->organization_id}/{$task->id}/".fake()->regexify('[A-Za-z0-9]{40}'),
        'original_name' => 'notes.txt',
        'mime' => 'text/plain',
        'size' => 11,
    ]);
}

function postLinkComment(array $payload, ?Task $task = null)
{
    $task ??= test()->task;
    Sanctum::actingAs(test()->author);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->postJson("/api/projects/{$task->project_id}/tasks/{$task->id}/comments", $payload);
}

it('links free attachments of the author and task, returning them with a signed url in store and index', function () {
    $first = linkTestAttachment($this->task, $this->author);
    $second = linkTestAttachment($this->task, $this->author);

    $response = postLinkComment(['body' => 'See files', 'attachment_ids' => [$second, $first]])->assertCreated();

    expect(array_column($response->json('data.attachments'), 'id'))->toBe([$first, $second])
        ->and(array_keys($response->json('data.attachments.0')))->toBe(['id', 'original_name', 'mime', 'size', 'created_at', 'url'])
        ->and($response->json('data.attachments.0.url'))->toContain('/api/task-attachments/'.$first)->toContain('signature=')
        ->and(DB::table('task_comment_attachments')->whereNotNull('task_comment_id')->count())->toBe(2);

    $this->getJson("/api/projects/{$this->project->id}/tasks/{$this->task->id}/comments")
        ->assertOk()
        ->assertJsonPath('data.0.attachments.0.id', $first)
        ->assertJsonPath('data.0.attachments.1.id', $second);
});

it('returns an empty list when the comment has no attachments', function () {
    postLinkComment(['body' => 'Plain'])->assertCreated()->assertJsonPath('data.attachments', []);
});

it('rejects attachments that are not usable with the same error and creates no comment', function (string $case) {
    $id = match ($case) {
        'other author' => linkTestAttachment($this->task, $this->colleague),
        'other task' => linkTestAttachment($this->otherTask, $this->author),
        'already linked' => linkTestAttachment(
            $this->task,
            $this->author,
            TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->author->id]),
        ),
        'missing' => 999999,
    };
    $before = DB::table('task_comments')->count();

    postLinkComment(['body' => 'Nope', 'attachment_ids' => [$id]])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('attachment_ids');

    expect(DB::table('task_comments')->count())->toBe($before);
})->with(['other author', 'other task', 'already linked', 'missing']);

it('rejects a list over the configured limit and malformed ids', function () {
    config(['chat.attachments.max_per_message' => 2]);
    $ids = [
        linkTestAttachment($this->task, $this->author),
        linkTestAttachment($this->task, $this->author),
        linkTestAttachment($this->task, $this->author),
    ];

    postLinkComment(['body' => 'Too many', 'attachment_ids' => $ids])->assertUnprocessable()->assertJsonValidationErrors('attachment_ids');
    postLinkComment(['body' => 'Dup', 'attachment_ids' => [$ids[0], $ids[0]]])->assertUnprocessable();
    postLinkComment(['body' => 'Bad', 'attachment_ids' => ['x']])->assertUnprocessable();

    expect(DB::table('task_comments')->count())->toBe(0);
});

it('rolls the comment back when the attachments were taken after validation', function () {
    $id = linkTestAttachment($this->task, $this->author);
    $other = TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->author->id]);
    $before = DB::table('task_comments')->count();

    DB::listen(function ($query) use ($id, $other) {
        if (str_starts_with($query->sql, 'insert into "task_comments"')) {
            DB::table('task_comment_attachments')->where('id', $id)->update(['task_comment_id' => $other->id]);
        }
    });

    postLinkComment(['body' => 'Race', 'attachment_ids' => [$id]])->assertUnprocessable();

    expect(DB::table('task_comments')->count())->toBe($before);
});

it('leaves no comment behind when saving the children fails', function () {
    $id = linkTestAttachment($this->task, $this->author);
    Schema::drop('task_comment_mentions');

    postLinkComment(['body' => "x <@{$this->colleague->id}>", 'attachment_ids' => [$id]])->assertServerError();

    expect(DB::table('task_comments')->count())->toBe(0);
});

it('broadcasts the attachments with the same shape as the response', function () {
    Event::fake([TaskCommentCreated::class]);
    $id = linkTestAttachment($this->task, $this->author);

    $response = postLinkComment(['body' => 'With file', 'attachment_ids' => [$id]])->assertCreated();

    Event::assertDispatched(TaskCommentCreated::class, function (TaskCommentCreated $event) use ($response, $id) {
        $comment = $event->broadcastWith()['comment'];

        return $comment['attachments'][0]['id'] === $id
            && json_decode(json_encode($comment), true) === $response->json('data');
    });
});
