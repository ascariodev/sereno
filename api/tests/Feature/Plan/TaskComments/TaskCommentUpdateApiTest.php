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
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->author = User::factory()->create();
    $this->organization->addMember($this->author, [Role::Member]);
    $this->ana = User::factory()->create(['name' => 'Ana']);
    $this->organization->addMember($this->ana, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->author);
    $this->project->addMember($this->ana);
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $this->task->project_id = $this->project->id;
    $this->task->number = 1;
    $this->task->save();
    $this->comment = TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->author->id, 'body' => 'Original']);
});

function patchComment(array $payload, ?User $user = null, ?int $taskId = null, ?int $commentId = null)
{
    Sanctum::actingAs($user ?? test()->author);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->patchJson('/api/projects/'.test()->project->id.'/tasks/'.($taskId ?? test()->task->id).'/comments/'.($commentId ?? test()->comment->id), $payload);
}

it('lets the author edit the body and marks it as edited', function () {
    Event::fake([TaskCommentUpdated::class]);

    patchComment(['body' => 'Changed'])
        ->assertOk()
        ->assertJsonPath('data.id', $this->comment->id)
        ->assertJsonPath('data.body', 'Changed')
        ->assertJsonPath('data.user.id', $this->author->id)
        ->assertJsonPath('data.mentions', [])
        ->assertJsonPath('data.attachments', []);

    $row = DB::table('task_comments')->where('id', $this->comment->id)->first();
    expect($row->body)->toBe('Changed')->and($row->edited_at)->not->toBeNull();
});

it('does not mark the comment as edited when the body is unchanged', function () {
    Event::fake([TaskCommentUpdated::class]);

    patchComment(['body' => 'Original'])->assertOk()->assertJsonPath('data.edited_at', null);

    expect(DB::table('task_comments')->where('id', $this->comment->id)->value('edited_at'))->toBeNull();
    Event::assertNotDispatched(TaskCommentUpdated::class);
});

it('forbids another member from editing', function () {
    patchComment(['body' => 'Hijacked'], $this->ana)->assertForbidden();

    expect(DB::table('task_comments')->where('id', $this->comment->id)->value('body'))->toBe('Original');
});

it('hides the comment from an author who lost access to the task', function () {
    $this->project->removeMember($this->author);

    patchComment(['body' => 'Changed'])->assertNotFound();
});

it('returns 404 when the comment belongs to another task', function () {
    $other = new Task(['title' => 'Other', 'position' => 2.0]);
    $other->project_id = $this->project->id;
    $other->number = 2;
    $other->save();

    patchComment(['body' => 'Changed'], taskId: $other->id)->assertNotFound();
});

it('returns 404 for a comment of another organization', function () {
    $otherOrganization = Organization::factory()->create();
    app(CurrentOrganization::class)->set($otherOrganization);
    $otherProject = Project::factory()->for($otherOrganization)->create();
    $otherTask = new Task(['title' => 'Other', 'position' => 1.0]);
    $otherTask->project_id = $otherProject->id;
    $otherTask->number = 1;
    $otherTask->save();
    $foreign = TaskComment::factory()->forTask($otherTask)->create(['user_id' => $this->author->id]);

    patchComment(['body' => 'Changed'], commentId: $foreign->id)->assertNotFound();
});

it('rejects an invalid body', function (mixed $body) {
    patchComment(['body' => $body])->assertUnprocessable()->assertJsonValidationErrors('body');
})->with([
    'empty' => '',
    'too long' => str_repeat('a', TaskComment::BODY_MAX_LENGTH + 1),
    'null byte' => "a\x00b",
]);

it('adds new mentions and removes the dropped ones', function () {
    $bea = User::factory()->create(['name' => 'Bea']);
    $this->organization->addMember($bea, [Role::Member]);
    $this->project->addMember($bea);
    DB::table('task_comment_mentions')->insert([
        'organization_id' => $this->organization->id,
        'task_comment_id' => $this->comment->id,
        'user_id' => $this->ana->id,
        'created_at' => now(),
    ]);

    patchComment(['body' => "Now <@{$bea->id}>"])
        ->assertOk()
        ->assertJsonPath('data.mentions', [['id' => $bea->id, 'name' => 'Bea']]);

    expect(DB::table('task_comment_mentions')->where('task_comment_id', $this->comment->id)->pluck('user_id')->all())
        ->toBe([$bea->id]);
});

it('keeps the mentions that stay in the body', function () {
    patchComment(['body' => "Hi <@{$this->ana->id}>"])->assertOk();
    patchComment(['body' => "Hello <@{$this->ana->id}>"])
        ->assertOk()
        ->assertJsonPath('data.mentions', [['id' => $this->ana->id, 'name' => 'Ana']]);

    expect(DB::table('task_comment_mentions')->where('task_comment_id', $this->comment->id)->count())->toBe(1);
});

it('respects the mention limit and excludes the author when editing', function () {
    config(['chat.mentions.max_per_message' => 1]);
    $other = User::factory()->create();
    $this->organization->addMember($other, [Role::Member]);
    $this->project->addMember($other);

    patchComment(['body' => "<@{$this->author->id}> <@{$other->id}> <@{$this->ana->id}>"])
        ->assertOk()
        ->assertJsonCount(1, 'data.mentions')
        ->assertJsonPath('data.mentions.0.id', $other->id);

    expect(DB::table('task_comment_mentions')->where('task_comment_id', $this->comment->id)->pluck('user_id')->all())
        ->toBe([$other->id]);
});
