<?php

use App\Actions\PostTaskGroupReopenedNotice;
use App\Enums\LogGroupStatus;
use App\Enums\Role;
use App\Events\LogGroupReopened;
use App\Listeners\PostTaskGroupReopenedNoticeListener;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\LogSource;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use App\Support\LogEventRecorder;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'PRJ', 'tasks_resolve_log_groups' => true]);
    assignMembersToAllProjects();
    app(CurrentOrganization::class)->set($this->organization);
    $this->channel = Channel::factory()->for($this->project)->create();
    $this->source = LogSource::factory()->for($this->project)->create();
    $this->group = LogGroup::factory()->for($this->project)->resolved()->create();
});

function reopenTask(LogGroup $group, string $status): Task
{
    $task = new Task(['title' => 'Task', 'status' => $status, 'position' => 1.0]);
    $task->project_id = $group->project_id;
    $task->log_group_id = $group->id;
    $task->number = Task::withoutGlobalScopes()->where('project_id', $group->project_id)->count() + 12;
    $task->save();

    return $task;
}

function reopenNotices(Channel $channel)
{
    return Message::withoutGlobalScopes()->where('channel_id', $channel->id)->where('payload->type', 'task.group_reopened')->get();
}

function reopenViaListener(LogGroup $group, bool $reopen = true): void
{
    if ($reopen) {
        $group->forceFill(['status' => LogGroupStatus::Open])->save();
    }

    app(PostTaskGroupReopenedNoticeListener::class)->handle(
        new LogGroupReopened($group->organization_id, $group->project_id, $group->id, 'error', 'T', 2),
    );
}

function reopenManually(User $user, Organization $organization, LogGroup $group, string $status = 'open')
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->patchJson("/api/projects/{$group->project_id}/log-groups/{$group->id}", ['status' => $status]);
}

it('posts the exact notice when the listener handles a reopening with the task in done', function () {
    $task = reopenTask($this->group, 'done');

    reopenViaListener($this->group);

    $message = reopenNotices($this->channel)->sole();
    expect($message->kind)->toBe(Message::KIND_SYSTEM)
        ->and($message->user_id)->toBeNull()
        ->and($message->log_group_id)->toBe($this->group->id)
        ->and($message->payload)->toEqual([
            'type' => 'task.group_reopened',
            'log_group_id' => $this->group->id,
            'task_id' => $task->id,
            'task_key' => 'PRJ-12',
        ]);
    expect($task->fresh()->status->value)->toBe('done')
        ->and($this->group->fresh()->status)->toBe(LogGroupStatus::Open);
});

it('posts it when ingestion reopens the group and the queue runs the listener', function () {
    $recorder = app(LogEventRecorder::class);
    $recorder->record($this->source, ['level' => 'error', 'message' => 'Boom']);
    $group = LogGroup::withoutGlobalScopes()->where('title', 'Boom')->firstOrFail();
    $group->forceFill(['status' => LogGroupStatus::Resolved])->save();
    $task = reopenTask($group, 'done');

    $recorder->record($this->source, ['level' => 'error', 'message' => 'Boom']);

    expect($group->fresh()->status)->toBe(LogGroupStatus::Open)
        ->and(reopenNotices($this->channel)->pluck('payload.task_id')->all())->toBe([$task->id]);
});

it('posts nothing without the setting, with the task in another status or without a task', function () {
    $other = LogGroup::factory()->for($this->project)->resolved()->create();
    reopenTask($this->group, 'in_review');
    reopenViaListener($this->group);
    reopenViaListener($other);

    $this->project->forceFill(['tasks_resolve_log_groups' => false])->save();
    $done = LogGroup::factory()->for($this->project)->resolved()->create();
    reopenTask($done, 'done');
    reopenViaListener($done);

    expect(reopenNotices($this->channel))->toBeEmpty();
});

it('posts nothing when the group was resolved again before the listener ran', function () {
    reopenTask($this->group, 'done');

    reopenViaListener($this->group, reopen: false);

    expect(reopenNotices($this->channel))->toBeEmpty();
});

it('posts nothing and does not fail when the project has no active channel', function () {
    reopenTask($this->group, 'done');
    $this->channel->forceFill(['archived_at' => now()])->save();

    reopenViaListener($this->group);

    expect(reopenNotices($this->channel))->toBeEmpty();
});

it('does not cross tenants', function () {
    reopenTask($this->group, 'done');
    $foreign = Organization::factory()->create();

    app(PostTaskGroupReopenedNotice::class)($foreign->id, $this->project->id, $this->group->id);

    expect(reopenNotices($this->channel))->toBeEmpty();
});

it('posts the notice when a member reopens a resolved group manually', function () {
    $task = reopenTask($this->group, 'done');

    reopenManually($this->member, $this->organization, $this->group)->assertOk()->assertJsonPath('data.status', 'open');

    expect(reopenNotices($this->channel)->sole()->payload)->toEqual([
        'type' => 'task.group_reopened',
        'log_group_id' => $this->group->id,
        'task_id' => $task->id,
        'task_key' => 'PRJ-12',
    ]);
});

it('does not post it for manual changes other than resolved to open', function () {
    reopenTask($this->group, 'done');
    $ignored = LogGroup::factory()->for($this->project)->ignored()->create();
    reopenTask($ignored, 'done');

    reopenManually($this->member, $this->organization, $ignored)->assertOk();
    reopenManually($this->member, $this->organization, $this->group, 'resolved')->assertOk();
    reopenManually($this->member, $this->organization, $this->group, 'ignored')->assertOk();

    expect(reopenNotices($this->channel))->toBeEmpty();
});

it('manual reopening without a channel does not fail', function () {
    reopenTask($this->group, 'done');
    DB::table('channels')->where('id', $this->channel->id)->update(['archived_at' => now()]);

    reopenManually($this->member, $this->organization, $this->group)->assertOk();

    expect(Message::withoutGlobalScopes()->count())->toBe(0);
});
