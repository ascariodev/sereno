<?php

use App\Enums\LogGroupStatus;
use App\Enums\Role;
use App\Events\TaskUpdated;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\MoveTaskTool;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\Event;

function moveToolTask(Project $project, string $status, float $position): Task
{
    $task = new Task(['title' => 'Task', 'status' => $status, 'position' => $position]);
    $task->project_id = $project->id;
    $task->number = (int) Task::withoutGlobalScopes()->where('project_id', $project->id)->max('number') + 1;
    $task->save();

    return $task;
}

function moveToolColumn(Project $project, string $status): array
{
    return Task::query()->where('project_id', $project->id)->where('status', $status)
        ->orderBy('position')->orderBy('id')->pluck('id')->all();
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->outsider = User::factory()->create();
    foreach ([$this->member, $this->outsider] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }

    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->members()->attach($this->member->id, ['organization_id' => $this->organization->id]);
    $this->otherProject = Project::factory()->for($this->organization)->create();
    $this->otherProject->members()->attach($this->member->id, ['organization_id' => $this->organization->id]);

    $this->call = function (User $user, array $arguments) {
        app(CurrentOrganization::class)->set($this->organization);

        return SerenoServer::actingAs($user)->tool(MoveTaskTool::class, $arguments);
    };

    app(CurrentOrganization::class)->set($this->organization);
    $this->task = moveToolTask($this->project, 'todo', 1.0);
});

it('moves the task to the top of the target column by default and emits the event', function () {
    Event::fake([TaskUpdated::class]);
    $first = moveToolTask($this->project, 'done', 1.0);
    $second = moveToolTask($this->project, 'done', 2.0);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'done',
    ])
        ->assertOk()
        ->assertStructuredContent(fn ($json) => $json->where('data.status', 'done')->etc());

    expect(moveToolColumn($this->project, 'done'))->toBe([$this->task->id, $first->id, $second->id]);
    Event::assertDispatched(TaskUpdated::class);
});

it('moves to an empty column', function () {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'in_progress',
    ])->assertOk();

    expect($this->task->fresh()->status->value)->toBe('in_progress')
        ->and($this->task->fresh()->position)->toEqual(1);
});

it('keeps the task at the top when it already is the first of its column', function () {
    $other = moveToolTask($this->project, 'todo', 2.0);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'todo',
    ])->assertOk();

    expect(moveToolColumn($this->project, 'todo'))->toBe([$this->task->id, $other->id]);
});

it('places the task after a neighbor', function () {
    $first = moveToolTask($this->project, 'done', 1.0);
    $second = moveToolTask($this->project, 'done', 2.0);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'done',
        'after_id' => $first->id,
    ])->assertOk();

    expect(moveToolColumn($this->project, 'done'))->toBe([$first->id, $this->task->id, $second->id]);
});

it('rejects a neighbor outside the target column', function () {
    $elsewhere = moveToolTask($this->project, 'in_progress', 1.0);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'done',
        'before_id' => $elsewhere->id,
    ])->assertHasErrors();

    expect($this->task->fresh()->status->value)->toBe('todo');
});

it('rejects an invalid status', function () {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'nope',
    ])->assertHasErrors();

    expect($this->task->fresh()->status->value)->toBe('todo');
});

it('rejects the task itself as neighbor', function () {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'done',
        'after_id' => $this->task->id,
    ])->assertHasErrors();
});

it('rejects an archived project', function () {
    $this->project->forceFill(['archived_at' => now()])->save();

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'done',
    ])->assertHasErrors();

    expect($this->task->fresh()->status->value)->toBe('todo');
});

it('rejects a project the user cannot see', function () {
    ($this->call)($this->outsider, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'done',
    ])->assertHasErrors();

    expect($this->task->fresh()->status->value)->toBe('todo');
});

it('rejects a task of another project', function () {
    $other = moveToolTask($this->otherProject, 'todo', 1.0);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $other->id,
        'status' => 'done',
    ])->assertHasErrors();

    expect($other->fresh()->status->value)->toBe('todo');
});

it('resolves the log group and posts the notice when the project asks for it', function () {
    $this->project->update(['tasks_resolve_log_groups' => true]);
    $channel = Channel::factory()->for($this->project)->create();
    $group = LogGroup::factory()->for($this->project)->create();
    $this->task->forceFill(['log_group_id' => $group->id])->save();

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'done',
    ])->assertOk();

    $message = Message::withoutGlobalScopes()->where('channel_id', $channel->id)->sole();
    expect($group->fresh()->status)->toBe(LogGroupStatus::Resolved)
        ->and($message->payload['type'])->toBe('log.group_status_changed')
        ->and($message->payload['status'])->toBe('resolved');
});

it('leaves the log group alone when the project does not ask for it', function () {
    $this->project->update(['tasks_resolve_log_groups' => false]);
    $channel = Channel::factory()->for($this->project)->create();
    $group = LogGroup::factory()->for($this->project)->create();
    $this->task->forceFill(['log_group_id' => $group->id])->save();

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'task_id' => $this->task->id,
        'status' => 'done',
    ])->assertOk();

    expect($group->fresh()->status)->toBe(LogGroupStatus::Open)
        ->and(Message::withoutGlobalScopes()->where('channel_id', $channel->id)->count())->toBe(0);
});
