<?php

use App\Actions\DeleteTask;
use App\Enums\NotificationType;
use App\Enums\Role;
use App\Models\AppNotification;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->recipient = User::factory()->create();
    $this->organization->addMember($this->recipient, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create();
    assignMembersToAllProjects();
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = cleanupTask($this->project, 1);
    $this->otherTask = cleanupTask($this->project, 2);
});

function cleanupTask(Project $project, int $number): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = $number;
    $task->save();

    return $task;
}

function cleanupNotify(Model $subject, ?User $user = null): AppNotification
{
    $row = new AppNotification;
    $row->forceFill([
        'uuid' => fake()->uuid(),
        'organization_id' => $subject->organization_id,
        'user_id' => ($user ?? test()->recipient)->id,
        'type' => NotificationType::TaskAssigned->value,
        'subject_type' => $subject::class,
        'subject_id' => $subject->id,
        'data' => [],
    ])->save();

    return $row;
}

function cleanupAs(string $url)
{
    Sanctum::actingAs(test()->admin);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)->deleteJson($url);
}

function cleanupRemaining(): array
{
    return AppNotification::query()->withoutGlobalScopes()->pluck('id')->all();
}

it('deletes the notifications of a task and of its comments, and keeps those of other tasks', function () {
    $comment = TaskComment::factory()->forTask($this->task)->create();
    $otherComment = TaskComment::factory()->forTask($this->otherTask)->create();
    cleanupNotify($this->task);
    cleanupNotify($comment);
    $keptTask = cleanupNotify($this->otherTask);
    $keptComment = cleanupNotify($otherComment);

    cleanupAs("/api/projects/{$this->project->id}/tasks/{$this->task->id}")->assertNoContent();

    expect(cleanupRemaining())->toEqualCanonicalizing([$keptTask->id, $keptComment->id]);
});

it('keeps the task notifications when the task delete rolls back', function () {
    $comment = TaskComment::factory()->forTask($this->task)->create();
    cleanupNotify($this->task);
    cleanupNotify($comment);

    try {
        DB::transaction(function () {
            app(DeleteTask::class)($this->task);

            throw new RuntimeException('rollback');
        });
    } catch (RuntimeException) {
    }

    expect(AppNotification::query()->withoutGlobalScopes()->count())->toBe(2);
});

it('deletes the notifications of a comment only', function () {
    $comment = TaskComment::factory()->forTask($this->task)->create();
    $other = TaskComment::factory()->forTask($this->task)->create();
    cleanupNotify($comment);
    $kept = cleanupNotify($other);
    $keptTask = cleanupNotify($this->task);

    cleanupAs("/api/projects/{$this->project->id}/tasks/{$this->task->id}/comments/{$comment->id}")->assertNoContent();

    expect(cleanupRemaining())->toEqualCanonicalizing([$kept->id, $keptTask->id]);
});

it('deletes the notifications of a deleted message and keeps those of its replies and other messages', function () {
    $channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    assignMembersToAllProjects();
    $root = Message::factory()->for($channel)->create(['kind' => Message::KIND_USER, 'user_id' => $this->admin->id, 'body' => 'root']);
    $reply = Message::factory()->for($channel)->create(['kind' => Message::KIND_USER, 'user_id' => $this->admin->id, 'body' => 'reply']);
    $reply->parent_id = $root->id;
    $reply->save();
    DB::table('messages')->where('id', $root->id)->update(['replies_count' => 1]);
    $other = Message::factory()->for($channel)->create(['kind' => Message::KIND_USER, 'user_id' => $this->admin->id, 'body' => 'other']);
    cleanupNotify($root);
    $keptReply = cleanupNotify($reply);
    $keptOther = cleanupNotify($other);

    cleanupAs("/api/channels/{$channel->id}/messages/{$root->id}")->assertOk();

    expect(cleanupRemaining())->toEqualCanonicalizing([$keptReply->id, $keptOther->id]);
});
