<?php

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
use App\Notifications\Channels\AppChannel;
use App\Notifications\ChatMentionNotification;
use App\Notifications\TaskAssignedNotification;
use App\Notifications\TaskCommentedNotification;
use App\Notifications\TaskCommentMentionNotification;
use App\Support\CurrentOrganization;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->user = User::factory()->create();
});

it('returns every type with email on by default', function () {
    Sanctum::actingAs($this->user);

    $response = $this->getJson('/api/me/notification-preferences')->assertOk();

    expect($response->json('data.email'))->toBe(array_fill_keys(array_column(NotificationType::cases(), 'value'), true));
});

it('merges a partial patch and keeps the other types', function () {
    Sanctum::actingAs($this->user);

    $this->patchJson('/api/me/notification-preferences', ['email' => ['task_assigned' => false]])
        ->assertOk()
        ->assertJsonPath('data.email.task_assigned', false)
        ->assertJsonPath('data.email.chat_mention', true);
    $this->patchJson('/api/me/notification-preferences', ['email' => ['chat_mention' => false]])
        ->assertOk()
        ->assertJsonPath('data.email.task_assigned', false)
        ->assertJsonPath('data.email.chat_mention', false);
    $this->patchJson('/api/me/notification-preferences', ['email' => ['task_assigned' => true]])
        ->assertJsonPath('data.email.task_assigned', true);

    expect($this->user->fresh()->wantsEmail(NotificationType::ChatMention))->toBeFalse();
});

it('rejects unknown types, non boolean values and a missing body', function (array $payload, string $field) {
    Sanctum::actingAs($this->user);

    $this->patchJson('/api/me/notification-preferences', $payload)->assertUnprocessable()->assertJsonValidationErrors($field);
    expect($this->user->fresh()->notification_preferences)->toBeNull();
})->with([
    'unknown type' => [['email' => ['nope' => false]], 'email'],
    'string value' => [['email' => ['task_assigned' => 'false']], 'email.task_assigned'],
    'null value' => [['email' => ['task_assigned' => null]], 'email.task_assigned'],
    'no body' => [[], 'email'],
    'string body' => [['email' => 'x'], 'email'],
    'number body' => [['email' => 5], 'email'],
]);

it('requires authentication', function () {
    $this->getJson('/api/me/notification-preferences')->assertUnauthorized();
    $this->patchJson('/api/me/notification-preferences', ['email' => []])->assertUnauthorized();
});

function liveNotificationFor(string $type): Notification
{
    $organization = Organization::factory()->create();
    $actor = User::factory()->create();
    $organization->addMember($actor, [Role::Member]);
    $organization->addMember(test()->user, [Role::Member]);
    $project = Project::factory()->for($organization)->create(['key' => 'POSVE']);
    $channel = Channel::factory()->for($project)->create();
    assignMembersToAllProjects();
    app(CurrentOrganization::class)->set($organization);
    $task = tap(new Task(['title' => 'T', 'status' => 'todo', 'position' => 1.0]), function (Task $task) use ($project, $actor) {
        $task->project_id = $project->id;
        $task->number = 1;
        $task->assignee_id = test()->user->id;
        $task->created_by = $actor->id;
        $task->save();
        $task->setRelation('project', $project);
    });
    $comment = tap(new TaskComment(['body' => 'x']), function (TaskComment $comment) use ($task, $actor) {
        $comment->task_id = $task->id;
        $comment->user_id = $actor->id;
        $comment->save();
    });
    DB::table('task_comment_mentions')->insert([
        'organization_id' => $organization->id, 'task_comment_id' => $comment->id, 'user_id' => test()->user->id, 'created_at' => now(),
    ]);
    $message = Message::factory()->for($channel)->create(['user_id' => $actor->id]);
    DB::table('message_mentions')->insert([
        'organization_id' => $organization->id, 'message_id' => $message->id, 'user_id' => test()->user->id, 'created_at' => now(),
    ]);
    $notification = match ($type) {
        NotificationType::TaskAssigned->value => TaskAssignedNotification::for($task, $actor),
        NotificationType::TaskCommentMention->value => new TaskCommentMentionNotification($organization->id, $project->id, $task->id, 'POSVE-1', 'T', $comment->id, 'x', $actor->id, 'A'),
        NotificationType::TaskCommented->value => new TaskCommentedNotification($organization->id, $project->id, $task->id, 'POSVE-1', 'T', $comment->id, 'x', $actor->id, 'A'),
        NotificationType::ChatMention->value => new ChatMentionNotification($organization->id, $project->id, $channel->id, $channel->name, $message->id, null, 'x', $actor->id, 'A'),
    };

    return $notification;
}

it('decides the mail channel in the worker from the current preference for every type', function (string $type) {
    $notification = liveNotificationFor($type);
    $this->user->update(['notification_preferences' => ['email' => [$type => false]]]);
    expect($notification->shouldSend($this->user->fresh(), 'mail'))->toBeFalse()
        ->and($notification->shouldSend($this->user->fresh(), AppChannel::class))->toBeTrue();

    $this->user->update(['notification_preferences' => ['email' => [$type => true]]]);
    expect($notification->shouldSend($this->user->fresh(), 'mail'))->toBeTrue();
})->with(array_column(NotificationType::cases(), 'value'));

function preferenceNotifications(): array
{
    return [
        NotificationType::TaskAssigned->value => new TaskAssignedNotification(1, 1, 1, 'P-1', 'T', 1, 'A'),
        NotificationType::TaskCommentMention->value => new TaskCommentMentionNotification(1, 1, 1, 'P-1', 'T', 1, 'x', 1, 'A'),
        NotificationType::TaskCommented->value => new TaskCommentedNotification(1, 1, 1, 'P-1', 'T', 1, 'x', 1, 'A'),
        NotificationType::ChatMention->value => new ChatMentionNotification(1, null, 1, 'c', 1, null, 'x', 1, 'A'),
    ];
}

it('drops the mail channel only for the type turned off', function (string $type) {
    $notification = preferenceNotifications()[$type];
    $others = array_diff(array_column(NotificationType::cases(), 'value'), [$type]);

    $this->user->update(['notification_preferences' => ['email' => [$type => false]]]);
    expect($notification->via($this->user->fresh()))->toBe([AppChannel::class]);

    $this->user->update(['notification_preferences' => ['email' => array_fill_keys($others, false)]]);
    expect($notification->via($this->user->fresh()))->toBe([AppChannel::class, 'mail']);
})->with(array_column(NotificationType::cases(), 'value'));

it('treats an absent or null type as on', function () {
    $this->user->update(['notification_preferences' => ['email' => ['task_assigned' => false]]]);

    expect($this->user->wantsEmail(NotificationType::TaskAssigned))->toBeFalse()
        ->and($this->user->wantsEmail(NotificationType::ChatMention))->toBeTrue();
});

it('skips the mail in the worker once the inbox notification was read, for every type', function (string $type) {
    $notification = liveNotificationFor($type);
    $notification->id = (string) Str::uuid();
    $this->user->notifyNow($notification, [AppChannel::class]);

    expect($notification->shouldSend($this->user->fresh(), 'mail'))->toBeTrue();

    AppNotification::query()->withoutGlobalScopes()->where('uuid', $notification->id)->update(['read_at' => now()]);

    expect($notification->shouldSend($this->user->fresh(), 'mail'))->toBeFalse()
        ->and($notification->shouldSend($this->user->fresh(), AppChannel::class))->toBeTrue();
})->with(array_column(NotificationType::cases(), 'value'));

it('delays only the mail channel by the configured minutes', function (string $type) {
    config(['workspace.notifications.mail_delay_minutes' => 7]);
    $this->freezeTime();
    $notification = preferenceNotifications()[$type];

    $delay = $notification->withDelay($this->user, 'mail');

    expect($delay['mail']->equalTo(now()->addMinutes(7)))->toBeTrue()
        ->and($notification->withDelay($this->user, AppChannel::class))->toBe([]);
})->with(array_column(NotificationType::cases(), 'value'));

it('treats an empty or negative mail delay as zero minutes', function (mixed $configured) {
    config(['workspace.notifications.mail_delay_minutes' => $configured]);
    $this->freezeTime();

    $delay = preferenceNotifications()[NotificationType::cases()[0]->value]->withDelay($this->user, 'mail');

    expect($delay['mail']->equalTo(now()))->toBeTrue();
})->with(['', -3, null]);
