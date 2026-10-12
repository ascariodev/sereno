<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->private = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->member);

    app(CurrentOrganization::class)->set($this->organization);
    $this->task = apiCommentTask($this->project);
    $this->privateTask = apiCommentTask($this->private);
});

function apiCommentTask(Project $project): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = 1;
    $task->save();

    return $task;
}

function commentsCall(User $user, Organization $organization, string $method, Project $project, Task $task, array $payload = [])
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->json($method, "/api/projects/{$project->id}/tasks/{$task->id}/comments", $payload);
}

it('creates a comment authored by the caller', function () {
    commentsCall($this->member, $this->organization, 'POST', $this->project, $this->task, ['body' => 'Hello **world**'])
        ->assertCreated()
        ->assertJsonPath('data.body', 'Hello **world**')
        ->assertJsonPath('data.user.id', $this->member->id)
        ->assertJsonPath('data.task_id', $this->task->id);

    expect(TaskComment::query()->where('task_id', $this->task->id)->count())->toBe(1);
});

it('returns a null edited_at for a new comment', function () {
    commentsCall($this->member, $this->organization, 'POST', $this->project, $this->task, ['body' => 'Hello'])
        ->assertCreated()
        ->assertJsonPath('data.edited_at', null);
});

it('lists comments newest first', function () {
    $first = TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->member->id]);
    $second = TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->member->id]);

    commentsCall($this->admin, $this->organization, 'GET', $this->project, $this->task)
        ->assertOk()
        ->assertJsonPath('data.0.id', $second->id)
        ->assertJsonPath('data.1.id', $first->id)
        ->assertJsonPath('data.0.user.name', $this->member->name);
});

it('paginates by cursor towards older comments', function () {
    $comments = TaskComment::factory()->forTask($this->task)->count(5)->create(['user_id' => $this->member->id]);

    $page = commentsCall($this->member, $this->organization, 'GET', $this->project, $this->task, ['per_page' => 2])
        ->assertOk()->assertJsonCount(2, 'data');
    expect(collect($page->json('data'))->pluck('id')->all())->toBe([$comments[4]->id, $comments[3]->id]);

    $cursor = $page->json('meta.next_cursor');
    expect($cursor)->not->toBeNull();

    $next = commentsCall($this->member, $this->organization, 'GET', $this->project, $this->task, ['per_page' => 2, 'cursor' => $cursor])
        ->assertOk();
    expect(collect($next->json('data'))->pluck('id')->all())->toBe([$comments[2]->id, $comments[1]->id]);

    $last = commentsCall($this->member, $this->organization, 'GET', $this->project, $this->task, ['per_page' => 2, 'cursor' => $next->json('meta.next_cursor')])
        ->assertOk()->assertJsonCount(1, 'data');
    expect($last->json('meta.next_cursor'))->toBeNull();
});

it('rejects an invalid cursor and per_page', function () {
    commentsCall($this->member, $this->organization, 'GET', $this->project, $this->task, ['cursor' => 'nope'])
        ->assertUnprocessable()->assertJsonValidationErrors(['cursor']);
    commentsCall($this->member, $this->organization, 'GET', $this->project, $this->task, ['per_page' => 101])
        ->assertUnprocessable()->assertJsonValidationErrors(['per_page']);
});

it('validates the body', function (mixed $body) {
    commentsCall($this->member, $this->organization, 'POST', $this->project, $this->task, ['body' => $body])
        ->assertUnprocessable()->assertJsonValidationErrors(['body']);

    expect(TaskComment::query()->count())->toBe(0);
})->with([
    'missing' => [null],
    'empty' => [''],
    'too long' => [fn () => str_repeat('a', TaskComment::BODY_MAX_LENGTH + 1)],
    'null byte' => ["a\x00b"],
]);

it('accepts a body of the maximum length', function () {
    commentsCall($this->member, $this->organization, 'POST', $this->project, $this->task, ['body' => str_repeat('a', TaskComment::BODY_MAX_LENGTH)])
        ->assertCreated();
});

it('hides the comments of a project the member is not assigned to', function () {
    commentsCall($this->member, $this->organization, 'GET', $this->private, $this->privateTask)->assertNotFound();
    commentsCall($this->member, $this->organization, 'POST', $this->private, $this->privateTask, ['body' => 'x'])->assertNotFound();
    commentsCall($this->member, $this->organization, 'POST', $this->private, $this->privateTask, [])->assertNotFound();

    expect(TaskComment::query()->count())->toBe(0);
});

it('lets an admin comment on any project', function () {
    commentsCall($this->admin, $this->organization, 'POST', $this->private, $this->privateTask, ['body' => 'ok'])->assertCreated();
});

it('answers 404 when the task belongs to another project', function () {
    commentsCall($this->admin, $this->organization, 'GET', $this->private, $this->task)->assertNotFound();
    commentsCall($this->admin, $this->organization, 'POST', $this->private, $this->task, ['body' => 'x'])->assertNotFound();
});

it('hides the comments of another organization', function () {
    $other = Organization::factory()->create();
    $outsider = User::factory()->create();
    $other->addMember($outsider, [Role::Admin]);

    commentsCall($outsider, $other, 'GET', $this->project, $this->task)->assertNotFound();
    commentsCall($outsider, $other, 'POST', $this->project, $this->task, ['body' => 'x'])->assertNotFound();
    commentsCall($outsider, $this->organization, 'GET', $this->project, $this->task)->assertForbidden();

    expect(TaskComment::query()->count())->toBe(0);
});

it('requires authentication', function () {
    $this->getJson("/api/projects/{$this->project->id}/tasks/{$this->task->id}/comments")->assertUnauthorized();
});
