<?php

use App\Enums\ContentSource;
use App\Enums\NotificationType;
use App\Enums\Role;
use App\Events\TaskCommentCreated;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\CommentOnTaskTool;
use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\Event;

function commentToolTask(Project $project): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = (int) Task::withoutGlobalScopes()->where('project_id', $project->id)->max('number') + 1;
    $task->save();

    return $task;
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->ana = User::factory()->create(['name' => 'Ana']);
    $this->outsider = User::factory()->create();
    foreach ([$this->member, $this->ana, $this->outsider] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }

    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->members()->attach([$this->member->id, $this->ana->id], ['organization_id' => $this->organization->id]);
    $this->otherProject = Project::factory()->for($this->organization)->create();
    $this->otherProject->members()->attach($this->member->id, ['organization_id' => $this->organization->id]);

    $this->call = function (User $user, array $arguments) {
        app(CurrentOrganization::class)->set($this->organization);

        return SerenoServer::actingAs($user)->tool(CommentOnTaskTool::class, $arguments);
    };

    app(CurrentOrganization::class)->set($this->organization);
    $this->task = commentToolTask($this->project);
});

it('creates the comment, stores the mention, notifies and emits the event', function () {
    Event::fake([TaskCommentCreated::class]);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'body' => "Look <@{$this->ana->id}>",
    ])
        ->assertOk()
        ->assertStructuredContent(fn ($json) => $json
            ->where('data.body', "Look <@{$this->ana->id}>")
            ->where('data.mentions.0.id', $this->ana->id)
            ->where('data.source', 'mcp')
            ->etc());

    $comment = TaskComment::query()->sole();
    expect($comment->user_id)->toBe($this->member->id)
        ->and($comment->task_id)->toBe($this->task->id)
        ->and($comment->source)->toBe(ContentSource::Mcp);
    Event::assertDispatched(TaskCommentCreated::class);
});

it('notifies the mentioned user through the listener', function () {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'body' => "Look <@{$this->ana->id}>",
    ])->assertOk();

    expect(AppNotification::query()->where('user_id', $this->ana->id)->where('type', NotificationType::TaskCommentMention->value)->count())->toBe(1);
});

it('rejects a project the user cannot see', function () {
    ($this->call)($this->outsider, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'body' => 'Hi',
    ])->assertHasErrors();

    expect(TaskComment::query()->count())->toBe(0);
});

it('rejects a task of another project', function () {
    $other = commentToolTask($this->otherProject);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $other->id,
        'body' => 'Hi',
    ])->assertHasErrors();

    expect(TaskComment::query()->count())->toBe(0);
});

it('rejects an empty body', function () {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'body' => '',
    ])->assertHasErrors();

    expect(TaskComment::query()->count())->toBe(0);
});

it('rejects a whitespace-only body', function () {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'body' => '  
	 ',
    ])->assertHasErrors();

    expect(TaskComment::query()->count())->toBe(0);
});

it('stores the body trimmed', function () {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'body' => '  Hello there 
',
    ])->assertOk();

    expect(TaskComment::query()->sole()->body)->toBe('Hello there');
});

it('rejects a body that is too long', function () {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'body' => str_repeat('a', TaskComment::BODY_MAX_LENGTH + 1),
    ])->assertHasErrors();

    expect(TaskComment::query()->count())->toBe(0);
});
