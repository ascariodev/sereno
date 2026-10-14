<?php

use App\Enums\Locale;
use App\Enums\NotificationType;
use App\Enums\Role;
use App\Events\NotificationCreated;
use App\Events\TaskAssigned;
use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Notifications\TaskAssignedNotification;
use App\Support\CurrentOrganization;
use Illuminate\Notifications\Events\NotificationSent;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->actor = User::factory()->create(['name' => 'Ana']);
    $this->organization->addMember($this->actor, [Role::Member]);
    $this->assignee = User::factory()->create(['locale' => Locale::Es]);
    $this->organization->addMember($this->assignee, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'POSVE']);
    assignMembersToAllProjects();
    app(CurrentOrganization::class)->set($this->organization);
});

function assignTaskAs(User $actor, Organization $organization, Project $project, array $payload, ?Task $task = null)
{
    Sanctum::actingAs($actor);
    $request = test()->withHeader('X-Organization-Id', (string) $organization->id);

    return $task === null
        ? $request->postJson("/api/projects/{$project->id}/tasks", $payload)
        : $request->patchJson("/api/projects/{$project->id}/tasks/{$task->id}", $payload);
}

it('notifies the assignee on creation through the app and mail channels', function () {
    Notification::fake();

    assignTaskAs($this->actor, $this->organization, $this->project, ['title' => 'Fix it', 'assignee_id' => $this->assignee->id])
        ->assertCreated();

    Notification::assertSentTo($this->assignee, TaskAssignedNotification::class, function (TaskAssignedNotification $notification) {
        return $notification->via($this->assignee) === [AppChannel::class, 'mail']
            && $notification->taskKey === 'POSVE-1'
            && $notification->actorId === $this->actor->id;
    });
    Notification::assertNothingSentTo($this->actor);
});

it('stores the in-app row with ids and short texts and sends the mail in the assignee locale', function () {
    $saved = tap(new Task(['title' => str_repeat('a', 190), 'status' => 'todo', 'position' => 1.0]), function (Task $task) {
        $task->project_id = $this->project->id;
        $task->number = 3;
        $task->assignee_id = $this->assignee->id;
        $task->save();
        $task->setRelation('project', $this->project);
    });
    $this->assignee->notifyNow(TaskAssignedNotification::for($saved, $this->actor));

    $row = AppNotification::query()->where('user_id', $this->assignee->id)->sole();
    expect($row->type)->toBe(NotificationType::TaskAssigned->value)
        ->and($row->organization_id)->toBe($this->organization->id)
        ->and($row->project_id)->toBe($this->project->id)
        ->and($row->subject_type)->toBe(Task::class)
        ->and($row->subject_id)->toBe($saved->id)
        ->and(collect($row->data)->keys()->sort()->values()->all())->toBe(['actor_id', 'actor_name', 'task_id', 'task_key', 'task_title'])
        ->and($row->data['task_key'])->toBe('POSVE-3')
        ->and(mb_strlen($row->data['task_title']))->toBeLessThanOrEqual(123);

    $notification = TaskAssignedNotification::for(
        tap(new Task(['title' => 'Fix it']), function (Task $task) {
            $task->forceFill(['id' => 7, 'organization_id' => $this->organization->id, 'project_id' => $this->project->id, 'number' => 3]);
            $task->setRelation('project', $this->project);
        }),
        $this->actor,
    );
    $previous = App::getLocale();
    App::setLocale($this->assignee->preferredLocale());
    $mail = $notification->toMail($this->assignee);
    App::setLocale($previous);

    expect($mail->subject)->toBe('Ana te asignó POSVE-3')
        ->and($mail->actionUrl)->toBe(config('app.frontend_url')."/projects/{$this->project->id}/plan?task=7&organization={$this->organization->id}")
        ->and($mail->actionText)->toBe('Ver tarea');
});

it('notifies on reassignment only when the assignee changes and is not the actor', function () {
    Notification::fake();
    $task = tap(new Task(['title' => 'Old', 'status' => 'todo', 'position' => 1.0]), function (Task $task) {
        $task->project_id = $this->project->id;
        $task->number = 1;
        $task->save();
    });

    assignTaskAs($this->actor, $this->organization, $this->project, ['assignee_id' => $this->actor->id], $task)->assertOk();
    assignTaskAs($this->actor, $this->organization, $this->project, ['assignee_id' => $this->assignee->id], $task)->assertOk();
    assignTaskAs($this->actor, $this->organization, $this->project, ['assignee_id' => $this->assignee->id], $task)->assertOk();
    assignTaskAs($this->actor, $this->organization, $this->project, ['assignee_id' => null], $task)->assertOk();

    Notification::assertSentToTimes($this->assignee, TaskAssignedNotification::class, 1);
    Notification::assertNothingSentTo($this->actor);
});

it('does not notify an assignee who lost access to the project in the meantime', function () {
    Notification::fake();
    Event::listen(TaskAssigned::class, fn () => $this->project->removeMember($this->assignee));

    assignTaskAs($this->actor, $this->organization, $this->project, ['title' => 'Fix it', 'assignee_id' => $this->assignee->id])
        ->assertCreated();

    Notification::assertNothingSent();
});

function taskAssignedQueuedJob(): array
{
    $task = tap(new Task(['title' => 'Old', 'status' => 'todo', 'position' => 1.0]), function (Task $task) {
        $task->project_id = test()->project->id;
        $task->number = 1;
        $task->assignee_id = test()->assignee->id;
        $task->save();
    });

    Event::fake([NotificationSent::class]);

    return [$task, TaskAssignedNotification::for($task->setRelation('project', test()->project), test()->actor)];
}

function taskAssignedChannelsSent(): array
{
    return Event::dispatched(NotificationSent::class)->map(fn (array $args) => $args[0]->channel)->sort()->values()->all();
}

it('does not send when the task was deleted before the job ran', function () {
    [$task, $notification] = taskAssignedQueuedJob();
    $task->delete();

    $this->assignee->notifyNow($notification);

    expect(AppNotification::query()->count())->toBe(0)->and(taskAssignedChannelsSent())->toBe([]);
});

it('does not send when the task was reassigned before the job ran', function () {
    [$task, $notification] = taskAssignedQueuedJob();
    $task->forceFill(['assignee_id' => $this->actor->id])->save();

    $this->assignee->notifyNow($notification);

    expect(AppNotification::query()->count())->toBe(0)->and(taskAssignedChannelsSent())->toBe([]);
});

it('does not send when the assignee lost access to the project before the job ran', function () {
    [, $notification] = taskAssignedQueuedJob();
    $this->project->removeMember($this->assignee);

    $this->assignee->notifyNow($notification);

    expect(AppNotification::query()->count())->toBe(0)->and(taskAssignedChannelsSent())->toBe([]);
});

it('sends the app and mail channels when the assignment still holds at execution', function () {
    [, $notification] = taskAssignedQueuedJob();

    $this->assignee->notifyNow($notification);

    expect(AppNotification::query()->count())->toBe(1)
        ->and(taskAssignedChannelsSent())->toBe([AppChannel::class, 'mail']);
});

it('renders actor and task title in the mail as plain text, not markdown, leaving the subject unescaped', function () {
    $notification = new TaskAssignedNotification(
        $this->organization->id, $this->project->id, 7, 'POSVE-3', '[t](http://evil.test) **b**', $this->actor->id, '[a](http://evil.test)',
    );

    $mail = $notification->toMail($this->assignee);
    $html = (string) $mail->render();

    expect($html)->toContain('[t](http://evil.test) **b**')->toContain('[a](http://evil.test)')
        ->not->toContain('href="http://evil.test"')
        ->not->toContain('<strong>b</strong>')
        ->and($mail->subject)->toContain('[a](http://evil.test)');
});

it('drops its row when the task is deleted after shouldSend passed but before the insert', function () {
    [$task, $notification] = taskAssignedQueuedJob();
    $notification->id = (string) Str::uuid();
    Event::fake([NotificationCreated::class]);
    $task->delete();

    app(AppChannel::class)->send($this->assignee, $notification);

    expect(AppNotification::query()->count())->toBe(0);
    Event::assertNotDispatched(NotificationCreated::class);
});

it('drops its row when the assignee loses access to the project after shouldSend passed but before the insert', function () {
    [, $notification] = taskAssignedQueuedJob();
    $notification->id = (string) Str::uuid();
    Event::fake([NotificationCreated::class]);
    $this->project->removeMember($this->assignee);

    app(AppChannel::class)->send($this->assignee, $notification);

    expect(AppNotification::query()->count())->toBe(0);
    Event::assertNotDispatched(NotificationCreated::class);
});
