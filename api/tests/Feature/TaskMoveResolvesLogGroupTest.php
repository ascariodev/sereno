<?php

use App\Enums\LogGroupStatus;
use App\Enums\Role;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create(['tasks_resolve_log_groups' => true]);
    assignMembersToAllProjects();
    app(CurrentOrganization::class)->set($this->organization);
    $this->channel = Channel::factory()->for($this->project)->create();
    $this->group = LogGroup::factory()->for($this->project)->create();
});

function groupTask(Project $project, ?LogGroup $group, string $status): Task
{
    $task = new Task(['title' => 'Task', 'status' => $status, 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->log_group_id = $group?->id;
    $task->number = (int) DB::selectOne(
        'UPDATE projects SET last_task_number = last_task_number + 1 WHERE id = ? RETURNING last_task_number',
        [$project->id],
    )->last_task_number;
    $task->save();

    return $task;
}

function moveGroupTask(User $user, Organization $organization, Project $project, Task $task, string $status)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->postJson("/api/projects/{$project->id}/tasks/{$task->id}/move", ['status' => $status]);
}

function groupNotices(Channel $channel)
{
    return Message::withoutGlobalScopes()->where('channel_id', $channel->id)->get();
}

it('resolves the open group and posts the status notice when the task enters done', function () {
    $task = groupTask($this->project, $this->group, 'in_review');

    moveGroupTask($this->member, $this->organization, $this->project, $task, 'done')
        ->assertOk()
        ->assertJsonPath('data.status', 'done')
        ->assertJsonPath('data.log_group.status', 'resolved');

    expect($this->group->fresh()->status)->toBe(LogGroupStatus::Resolved);
    $message = groupNotices($this->channel)->sole();
    expect($message->kind)->toBe(Message::KIND_SYSTEM)
        ->and($message->user_id)->toBe($this->member->id)
        ->and($message->log_group_id)->toBe($this->group->id)
        ->and($message->payload)->toEqual([
            'type' => 'log.group_status_changed',
            'log_group_id' => $this->group->id,
            'title' => $this->group->title,
            'status' => 'resolved',
            'previous_status' => 'open',
        ]);
});

it('leaves the group alone when the project does not have the setting', function () {
    $this->project->update(['tasks_resolve_log_groups' => false]);
    $task = groupTask($this->project, $this->group, 'todo');

    moveGroupTask($this->member, $this->organization, $this->project, $task, 'done')->assertOk();

    expect($this->group->fresh()->status)->toBe(LogGroupStatus::Open)
        ->and(groupNotices($this->channel))->toBeEmpty();
});

it('does not touch an ignored or resolved group', function (string $groupStatus) {
    $this->group->update(['status' => $groupStatus]);
    $task = groupTask($this->project, $this->group, 'in_progress');

    moveGroupTask($this->member, $this->organization, $this->project, $task, 'done')->assertOk();

    expect($this->group->fresh()->status->value)->toBe($groupStatus)
        ->and(groupNotices($this->channel))->toBeEmpty();
})->with(['ignored', 'resolved']);

it('moves a task without a group into done', function () {
    $task = groupTask($this->project, null, 'todo');

    moveGroupTask($this->member, $this->organization, $this->project, $task, 'done')
        ->assertOk()
        ->assertJsonPath('data.status', 'done');

    expect($this->group->fresh()->status)->toBe(LogGroupStatus::Open)
        ->and(groupNotices($this->channel))->toBeEmpty();
});

it('does not resolve the group when the task moves within done', function () {
    $task = groupTask($this->project, $this->group, 'done');

    moveGroupTask($this->member, $this->organization, $this->project, $task, 'done')->assertOk();

    expect($this->group->fresh()->status)->toBe(LogGroupStatus::Open)
        ->and(groupNotices($this->channel))->toBeEmpty();
});

it('does not reopen the group when the task leaves done', function () {
    $this->group->update(['status' => 'resolved']);
    $task = groupTask($this->project, $this->group, 'done');

    moveGroupTask($this->member, $this->organization, $this->project, $task, 'in_progress')
        ->assertOk()
        ->assertJsonPath('data.status', 'in_progress');

    expect($this->group->fresh()->status)->toBe(LogGroupStatus::Resolved)
        ->and(groupNotices($this->channel))->toBeEmpty();
});

it('resolves the group without a notice when the project has no active channel', function () {
    $this->channel->forceFill(['archived_at' => now()])->save();
    $task = groupTask($this->project, $this->group, 'todo');

    moveGroupTask($this->member, $this->organization, $this->project, $task, 'done')->assertOk();

    expect($this->group->fresh()->status)->toBe(LogGroupStatus::Resolved)
        ->and(groupNotices($this->channel))->toBeEmpty();
});
