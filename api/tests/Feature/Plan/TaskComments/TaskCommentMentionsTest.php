<?php

use App\Enums\Role;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
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
});

function postMentionComment(string $body)
{
    Sanctum::actingAs(test()->author);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->postJson('/api/projects/'.test()->project->id.'/tasks/'.test()->task->id.'/comments', ['body' => $body]);
}

it('stores the mentions and returns them in store and index', function () {
    $response = postMentionComment("Look <@{$this->ana->id}>")->assertCreated();

    expect($response->json('data.mentions'))->toBe([['id' => $this->ana->id, 'name' => 'Ana']])
        ->and(DB::table('task_comment_mentions')->count())->toBe(1);

    $this->getJson('/api/projects/'.$this->project->id.'/tasks/'.$this->task->id.'/comments')
        ->assertOk()
        ->assertJsonPath('data.0.mentions', [['id' => $this->ana->id, 'name' => 'Ana']]);
});

it('returns an empty list when nobody is mentioned', function () {
    postMentionComment('Plain')->assertCreated()->assertJsonPath('data.mentions', []);
});

it('ignores users without access to the project', function () {
    $outsider = User::factory()->create();
    $this->organization->addMember($outsider, [Role::Member]);

    postMentionComment("<@{$outsider->id}> <@{$this->ana->id}>")
        ->assertCreated()
        ->assertJsonCount(1, 'data.mentions');

    expect(DB::table('task_comment_mentions')->where('user_id', $outsider->id)->exists())->toBeFalse();
});

it('excludes the author', function () {
    postMentionComment("<@{$this->author->id}>")->assertCreated()->assertJsonPath('data.mentions', []);

    expect(DB::table('task_comment_mentions')->count())->toBe(0);
});

it('keeps only the first mentions up to the limit', function () {
    config(['chat.mentions.max_per_message' => 1]);
    $other = User::factory()->create();
    $this->organization->addMember($other, [Role::Member]);
    $this->project->addMember($other);

    postMentionComment("<@{$other->id}> <@{$this->ana->id}>")
        ->assertCreated()
        ->assertJsonCount(1, 'data.mentions')
        ->assertJsonPath('data.mentions.0.id', $other->id);
});

it('deletes the mentions with the comment and rejects cross tenant rows', function () {
    $comment = TaskComment::factory()->forTask($this->task)->create();
    $row = fn (int $organizationId) => DB::table('task_comment_mentions')->insert([
        'organization_id' => $organizationId,
        'task_comment_id' => $comment->id,
        'user_id' => $this->ana->id,
    ]);

    $row($this->organization->id);
    $comment->delete();
    expect(DB::table('task_comment_mentions')->count())->toBe(0);

    $comment = TaskComment::factory()->forTask($this->task)->create();
    expect(fn () => DB::table('task_comment_mentions')->insert([
        'organization_id' => Organization::factory()->create()->id,
        'task_comment_id' => $comment->id,
        'user_id' => $this->ana->id,
    ]))->toThrow(QueryException::class, 'task_comment_mentions_comment_organization_fk');
});

it('leaves no comment behind when saving the mentions fails', function () {
    Schema::drop('task_comment_mentions');

    postMentionComment("<@{$this->ana->id}>")->assertServerError();

    expect(DB::table('task_comments')->count())->toBe(0);
});
