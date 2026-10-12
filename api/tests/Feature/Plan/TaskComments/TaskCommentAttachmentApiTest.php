<?php

use App\Enums\Role;
use App\Models\MessageAttachment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\TaskCommentAttachment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    RateLimiter::clear('chat-attachments');
    Storage::fake('local');
    config(['chat.attachments.disk' => 'local']);

    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->private = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->member);

    app(CurrentOrganization::class)->set($this->organization);
    $this->task = attachmentTask($this->project);
    $this->privateTask = attachmentTask($this->private);
    $this->comment = TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->member->id]);

    app(CurrentOrganization::class)->set($this->other);
    $this->foreignProject = Project::factory()->for($this->other)->create();
    $this->foreignTask = attachmentTask($this->foreignProject);
    $this->foreignComment = TaskComment::factory()->forTask($this->foreignTask)->create(['user_id' => $this->outsider->id]);
    app(CurrentOrganization::class)->set($this->organization);

    $this->url = "/api/projects/{$this->project->id}/tasks/{$this->task->id}/attachments";
});

function attachmentTask(Project $project): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = 1;
    $task->save();

    return $task;
}

function taskUploadFixture(string $content, string $clientName = 'notes.txt'): UploadedFile
{
    $tmp = tempnam(sys_get_temp_dir(), 'tatt');
    file_put_contents($tmp, $content);

    return new UploadedFile($tmp, $clientName, 'text/plain', null, true);
}

function taskUploadingAs(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

function storedTaskAttachment(Task $task, ?TaskComment $comment, ?string $content = 'hello world'): TaskCommentAttachment
{
    $path = "tasks/{$task->organization_id}/{$task->id}/".fake()->regexify('[A-Za-z0-9]{40}');

    if ($content !== null) {
        Storage::disk('local')->put($path, $content);
    }

    $id = DB::table('task_comment_attachments')->insertGetId([
        'organization_id' => $task->organization_id,
        'task_id' => $task->id,
        'task_comment_id' => $comment?->id,
        'user_id' => $comment?->user_id,
        'disk' => 'local',
        'path' => $path,
        'original_name' => 'notes.txt',
        'mime' => 'text/plain',
        'size' => strlen((string) $content),
    ]);

    return TaskCommentAttachment::withoutGlobalScopes()->findOrFail($id);
}

// Without Bearer, X-Organization-Id nor active tenant, like an <img> in the browser.
function fetchTaskAttachment(string $url, array $server = []): TestResponse
{
    app(CurrentOrganization::class)->set(null);
    app('auth')->forgetGuards();

    return test()->flushHeaders()->withServerVariables($server)->get($url);
}

it('stores the upload for the task without a comment and records who uploaded it', function () {
    $response = taskUploadingAs($this->member, $this->organization)
        ->postJson($this->url, [
            'file' => taskUploadFixture('hello world'),
            'task_comment_id' => $this->comment->id,
            'user_id' => $this->admin->id,
            'path' => 'evil',
        ])
        ->assertCreated();

    $attachment = TaskCommentAttachment::withoutGlobalScopes()->sole();

    expect(array_keys($response->json('data')))->toBe(['id', 'original_name', 'mime', 'size', 'created_at', 'url'])
        ->and($response->json('data.id'))->toBe($attachment->id)
        ->and($response->json('data.mime'))->toBe('text/plain')
        ->and($response->json('data.size'))->toBe(11)
        ->and($attachment->organization_id)->toBe($this->organization->id)
        ->and($attachment->task_id)->toBe($this->task->id)
        ->and($attachment->task_comment_id)->toBeNull()
        ->and($attachment->user_id)->toBe($this->member->id)
        ->and($attachment->path)->toMatch("#^tasks/{$this->organization->id}/{$this->task->id}/[A-Za-z0-9]{40}$#")
        ->and(Storage::disk('local')->allFiles())->toBe([$attachment->path]);
});

it('hides a private project from a member before validating and lets an admin upload to it', function (array $payload) {
    $privateUrl = "/api/projects/{$this->private->id}/tasks/{$this->privateTask->id}/attachments";

    taskUploadingAs($this->member, $this->organization)
        ->postJson($privateUrl, $payload)
        ->assertNotFound();

    expect(Storage::disk('local')->allFiles())->toBe([]);

    taskUploadingAs($this->admin, $this->organization)
        ->postJson($privateUrl, ['file' => taskUploadFixture('x')])
        ->assertCreated();
})->with([
    'valid file' => [fn () => ['file' => taskUploadFixture('x')]],
    'invalid input' => [[]],
]);

it('answers 404 for a task of another project', function () {
    taskUploadingAs($this->admin, $this->organization)
        ->postJson("/api/projects/{$this->private->id}/tasks/{$this->task->id}/attachments", ['file' => taskUploadFixture('x')])
        ->assertNotFound();

    expect(TaskCommentAttachment::withoutGlobalScopes()->count())->toBe(0);
});

it('hides tasks of other organizations and requires membership before validating', function (array $payload) {
    taskUploadingAs($this->outsider, $this->other)
        ->postJson($this->url, $payload)
        ->assertNotFound();

    taskUploadingAs($this->outsider, $this->organization)
        ->postJson($this->url, $payload)
        ->assertForbidden();

    expect(Storage::disk('local')->allFiles())->toBe([])
        ->and(TaskCommentAttachment::withoutGlobalScopes()->count())->toBe(0);
})->with([
    'valid file' => [fn () => ['file' => taskUploadFixture('x')]],
    'invalid input' => [[]],
]);

it('enforces the configured maximum size', function () {
    config(['chat.attachments.max_size_kb' => 1]);

    taskUploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => taskUploadFixture(str_repeat('a', 1025))])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('file');

    expect(Storage::disk('local')->allFiles())->toBe([]);

    taskUploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => taskUploadFixture(str_repeat('a', 1024))])
        ->assertCreated()
        ->assertJsonPath('data.size', 1024);
});

it('rejects an empty or missing file with a translated error', function () {
    taskUploadingAs($this->member, $this->organization)
        ->withHeader('Accept-Language', 'es')
        ->postJson($this->url, ['file' => taskUploadFixture('')])
        ->assertUnprocessable()
        ->assertJsonPath('errors.file.0', 'El archivo está vacío.');

    taskUploadingAs($this->member, $this->organization)
        ->postJson($this->url, [])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('file');

    expect(TaskCommentAttachment::withoutGlobalScopes()->count())->toBe(0);
});

it('removes the stored file when the row cannot be written', function () {
    TaskCommentAttachment::creating(fn () => throw new RuntimeException('database down'));

    taskUploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => taskUploadFixture('x')])
        ->assertServerError();

    expect(Storage::disk('local')->allFiles())->toBe([]);
});

it('rejects a task or comment of another organization at the database', function (string $case) {
    $row = [
        'organization_id' => $this->organization->id,
        'task_id' => $this->task->id,
        'task_comment_id' => null,
        'disk' => 'local',
        'path' => 'x',
        'original_name' => 'x',
        'mime' => 'text/plain',
        'size' => 1,
    ];
    $row = match ($case) {
        'task' => [...$row, 'task_id' => $this->foreignTask->id],
        'comment' => [...$row, 'task_comment_id' => $this->foreignComment->id],
    };

    expect(fn () => DB::table('task_comment_attachments')->insert($row))->toThrow(QueryException::class);
})->with(['task', 'comment']);

it('downloads a linked attachment with a signed url without bearer nor organization', function () {
    $attachment = storedTaskAttachment($this->task, $this->comment);
    $url = $attachment->downloadUrl();

    expect($url)->toStartWith(rtrim(config('app.url'), '/')."/api/task-attachments/{$attachment->id}?expires=");

    expect(fetchTaskAttachment($url)->assertOk()->streamedContent())->toBe('hello world');
});

it('rejects an expired url', function () {
    $this->freezeTime();
    $attachment = storedTaskAttachment($this->task, $this->comment);
    $url = $attachment->downloadUrl();
    parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

    $this->travelTo(now()->setTimestamp((int) $query['expires'] - 1));
    fetchTaskAttachment($url)->assertOk();

    $this->travelTo(now()->setTimestamp((int) $query['expires'] + 1));
    fetchTaskAttachment($url)->assertForbidden();
});

it('rejects a tampered url, also towards an attachment of another organization', function (Closure $tamper) {
    $attachment = storedTaskAttachment($this->task, $this->comment);
    $foreign = storedTaskAttachment($this->foreignTask, $this->foreignComment, 'secret');
    $chat = new MessageAttachment;
    $chat->id = $attachment->id;

    fetchTaskAttachment($tamper($attachment->downloadUrl(), $attachment, $foreign, $chat), ['HTTP_ACCEPT_LANGUAGE' => 'es'])
        ->assertForbidden()
        ->assertJsonPath('message', 'El enlace no es válido o ha vencido.');
})->with([
    'unsigned' => fn (string $url, TaskCommentAttachment $a) => "/api/task-attachments/{$a->id}",
    'altered signature' => fn (string $url) => preg_replace('/signature=(.)/', 'signature=$1$1', $url),
    'extended expiry' => fn (string $url) => preg_replace_callback('/expires=(\d+)/', fn ($m) => 'expires='.($m[1] + 3600), $url),
    'other organization' => fn (string $url, TaskCommentAttachment $a, TaskCommentAttachment $f) => str_replace("/task-attachments/{$a->id}?", "/task-attachments/{$f->id}?", $url),
    'chat signature' => fn (string $url, TaskCommentAttachment $a, TaskCommentAttachment $f, MessageAttachment $c) => str_replace('/api/attachments/', '/api/task-attachments/', $c->downloadUrl()),
]);

it('answers 404 for a signed url of an orphan or missing file', function (string $case) {
    $attachment = match ($case) {
        'orphan' => storedTaskAttachment($this->task, null),
        'missing file' => storedTaskAttachment($this->task, $this->comment, null),
    };

    fetchTaskAttachment($attachment->downloadUrl())->assertNotFound();
})->with(['orphan', 'missing file']);

it('returns a fresh signed url to whoever can see the task', function () {
    $attachment = storedTaskAttachment($this->task, $this->comment);

    $response = taskUploadingAs($this->member, $this->organization)
        ->getJson("/api/task-attachments/{$attachment->id}/url")
        ->assertOk();

    expect($response->json('data.url'))->toStartWith(rtrim(config('app.url'), '/')."/api/task-attachments/{$attachment->id}?expires=")
        ->and($response->json('data.expires_at'))->not->toBeNull();
    expect(fetchTaskAttachment($response->json('data.url'))->assertOk()->streamedContent())->toBe('hello world');
});

it('hands out a fresh url for a missing file, whose download answers 404', function () {
    $attachment = storedTaskAttachment($this->task, $this->comment, null);

    $response = taskUploadingAs($this->member, $this->organization)
        ->getJson("/api/task-attachments/{$attachment->id}/url")
        ->assertOk();

    fetchTaskAttachment($response->json('data.url'))->assertNotFound();
});

it('answers 404 for a fresh url without access, of another organization or of an orphan', function (string $case) {
    [$user, $organization, $attachment] = match ($case) {
        'private project' => (function () {
            app(CurrentOrganization::class)->set($this->organization);
            $comment = TaskComment::factory()->forTask($this->privateTask)->create(['user_id' => $this->admin->id]);

            return [$this->member, $this->organization, storedTaskAttachment($this->privateTask, $comment)];
        })(),
        'other organization' => [$this->member, $this->organization, storedTaskAttachment($this->foreignTask, $this->foreignComment)],
        'orphan' => [$this->member, $this->organization, storedTaskAttachment($this->task, null)],
    };

    taskUploadingAs($user, $organization)
        ->getJson("/api/task-attachments/{$attachment->id}/url")
        ->assertNotFound();
})->with(['private project', 'other organization', 'orphan']);
