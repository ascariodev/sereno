<?php

use App\Enums\Role;
use App\Enums\TaskStatus;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\GetTaskTool;
use App\Mcp\Tools\ListTasksTool;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;

function readToolsTask(Project $project, string $title, TaskStatus $status = TaskStatus::Todo, ?User $assignee = null, float $position = 1.0): Task
{
    $task = new Task(['title' => $title, 'status' => $status, 'position' => $position]);
    $task->project_id = $project->id;
    $task->number = (int) Task::withoutGlobalScopes()->where('project_id', $project->id)->max('number') + 1;
    $task->assignee_id = $assignee?->id;
    $task->save();

    return $task;
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->owner = User::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
    $this->organization->addMember($this->member, [Role::Member]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->hiddenProject = Project::factory()->for($this->organization)->create();
    $this->project->members()->attach($this->member->id, ['organization_id' => $this->organization->id]);

    $this->otherOrganization = Organization::factory()->create();
    $this->foreignProject = Project::factory()->for($this->otherOrganization)->create();

    $this->call = function (string $tool, User $user, array $arguments = []) {
        app(CurrentOrganization::class)->set($this->organization);

        return SerenoServer::actingAs($user)->tool($tool, $arguments);
    };

    app(CurrentOrganization::class)->set($this->organization);
});

it('lists the tasks of a project by column and position', function () {
    readToolsTask($this->project, 'Review one', TaskStatus::InReview);
    readToolsTask($this->project, 'Todo two', TaskStatus::Todo, position: 2.0);
    readToolsTask($this->project, 'Todo one', TaskStatus::Todo, position: 1.0);
    readToolsTask($this->project, 'Finished', TaskStatus::Done);
    readToolsTask($this->hiddenProject, 'Elsewhere');

    ($this->call)(ListTasksTool::class, $this->member, ['project_id' => $this->project->id])
        ->assertOk()
        ->assertSee(['Todo one', 'Todo two', 'Review one', 'Finished'])
        ->assertDontSee('Elsewhere')
        ->assertStructuredContent(fn ($json) => $json
            ->has('data', 4)
            ->where('data.0.title', 'Todo one')
            ->where('data.1.title', 'Todo two')
            ->where('data.2.title', 'Review one')
            ->where('data.3.title', 'Finished')
            ->where('meta.done_total', 1)
            ->where('meta.has_more_done', false)
            ->etc());
});

it('filters by status, assignee and title', function () {
    readToolsTask($this->project, 'Fix the Login page', TaskStatus::InProgress, $this->member);
    readToolsTask($this->project, 'Fix the logout', TaskStatus::Todo, $this->owner);
    readToolsTask($this->project, '100% done_deal', TaskStatus::Todo);

    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => $this->project->id, 'status' => 'todo'])
        ->assertSee(['logout', 'done_deal'])
        ->assertDontSee('Login page');

    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => $this->project->id, 'assignee_id' => $this->member->id])
        ->assertSee('Login page')
        ->assertDontSee(['logout', 'done_deal']);

    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => $this->project->id, 'search' => 'LOGIN'])
        ->assertSee('Login page')
        ->assertDontSee(['logout', 'done_deal']);

    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => $this->project->id, 'search' => '%'])
        ->assertSee('done_deal')
        ->assertDontSee(['Login page', 'logout']);

    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => $this->project->id, 'search' => '_'])
        ->assertSee('done_deal')
        ->assertDontSee('Login page');
});

it('keeps only the most recent done tasks with done_limit', function () {
    readToolsTask($this->project, 'Done old', TaskStatus::Done, position: 1.0);
    readToolsTask($this->project, 'Done new', TaskStatus::Done, position: 2.0);

    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => $this->project->id, 'done_limit' => 1])
        ->assertOk()
        ->assertSee('Done new')
        ->assertDontSee('Done old')
        ->assertStructuredContent(fn ($json) => $json
            ->where('meta.done_total', 2)
            ->where('meta.has_more_done', true)
            ->etc());
});

it('answers not found for a project the user cannot see or that belongs to another organization', function () {
    readToolsTask($this->hiddenProject, 'Secret');

    ($this->call)(ListTasksTool::class, $this->member, ['project_id' => $this->hiddenProject->id])
        ->assertHasErrors(['Not found.'])
        ->assertDontSee('Secret');

    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => $this->foreignProject->id])
        ->assertHasErrors(['Not found.']);

    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => 999999999])
        ->assertHasErrors(['Not found.']);
});

it('validates the list filters', function () {
    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => $this->project->id, 'status' => 'nope'])->assertHasErrors();
    ($this->call)(ListTasksTool::class, $this->owner, ['project_id' => $this->project->id, 'done_limit' => 0])->assertHasErrors();
    ($this->call)(ListTasksTool::class, $this->owner, [])->assertHasErrors();
});

it('returns a task with its comments newest first', function () {
    $task = readToolsTask($this->project, 'Write docs', TaskStatus::InProgress, $this->member);
    $first = TaskComment::factory()->forTask($task)->create(['user_id' => $this->owner->id, 'body' => 'First comment']);
    $second = TaskComment::factory()->forTask($task)->create(['user_id' => $this->member->id, 'body' => 'Second comment']);

    ($this->call)(GetTaskTool::class, $this->member, ['project_id' => $this->project->id, 'task_id' => $task->id])
        ->assertOk()
        ->assertSee(['Write docs', 'First comment', 'Second comment'])
        ->assertStructuredContent(fn ($json) => $json
            ->where('data.id', $task->id)
            ->where('data.key', $this->project->key.'-1')
            ->where('data.assignee.id', $this->member->id)
            ->where('data.comments_count', 2)
            ->has('comments.data', 2)
            ->where('comments.data.0.id', $second->id)
            ->where('comments.data.1.id', $first->id)
            ->where('comments.next_cursor', null)
            ->etc());
});

it('pages the comments with a cursor', function () {
    $task = readToolsTask($this->project, 'Many comments');
    $comments = TaskComment::factory()->forTask($task)->count(3)->create(['user_id' => $this->owner->id]);

    $firstPage = null;
    ($this->call)(GetTaskTool::class, $this->owner, ['project_id' => $this->project->id, 'task_id' => $task->id, 'per_page' => 2])
        ->assertStructuredContent(function ($json) use (&$firstPage, $comments) {
            $json->has('comments.data', 2)
                ->where('comments.data.0.id', $comments[2]->id)
                ->where('comments.data.1.id', $comments[1]->id)
                ->etc();
            $firstPage = $json->toArray()['comments']['next_cursor'];

            return $json;
        });

    expect($firstPage)->toBeString();

    ($this->call)(GetTaskTool::class, $this->owner, ['project_id' => $this->project->id, 'task_id' => $task->id, 'per_page' => 2, 'cursor' => $firstPage])
        ->assertStructuredContent(fn ($json) => $json
            ->has('comments.data', 1)
            ->where('comments.data.0.id', $comments[0]->id)
            ->where('comments.next_cursor', null)
            ->etc());
});

it('rejects an invalid cursor', function () {
    $task = readToolsTask($this->project, 'Task');

    ($this->call)(GetTaskTool::class, $this->owner, ['project_id' => $this->project->id, 'task_id' => $task->id, 'cursor' => 'garbage'])
        ->assertHasErrors();
});

it('answers not found for a task of another project, a hidden one or another organization', function () {
    $task = readToolsTask($this->project, 'Mine');
    $hidden = readToolsTask($this->hiddenProject, 'Secret task');
    TaskComment::factory()->forTask($hidden)->create(['user_id' => $this->owner->id, 'body' => 'Secret comment']);

    ($this->call)(GetTaskTool::class, $this->owner, ['project_id' => $this->project->id, 'task_id' => $hidden->id])
        ->assertHasErrors(['Not found.'])
        ->assertDontSee(['Secret task', 'Secret comment']);

    ($this->call)(GetTaskTool::class, $this->member, ['project_id' => $this->hiddenProject->id, 'task_id' => $hidden->id])
        ->assertHasErrors(['Not found.'])
        ->assertDontSee(['Secret task', 'Secret comment']);

    ($this->call)(GetTaskTool::class, $this->owner, ['project_id' => $this->foreignProject->id, 'task_id' => $task->id])
        ->assertHasErrors(['Not found.']);

    ($this->call)(GetTaskTool::class, $this->owner, ['project_id' => $this->project->id, 'task_id' => 999999999])
        ->assertHasErrors(['Not found.']);
});

it('fails closed without an active organization', function () {
    app(CurrentOrganization::class)->set(null);

    SerenoServer::actingAs($this->owner)->tool(ListTasksTool::class, ['project_id' => $this->project->id])
        ->assertHasErrors(['You do not belong to this organization.']);
    SerenoServer::actingAs($this->owner)->tool(GetTaskTool::class, ['project_id' => $this->project->id, 'task_id' => 1])
        ->assertHasErrors(['You do not belong to this organization.']);
});

it('registers both tools in the server', function () {
    SerenoServer::actingAs($this->owner)->tools()->assertRegistered([ListTasksTool::class, GetTaskTool::class]);
});
