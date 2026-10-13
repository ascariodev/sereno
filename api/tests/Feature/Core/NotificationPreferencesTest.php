<?php

use App\Enums\NotificationType;
use App\Enums\Role;
use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Notifications\ChatMentionNotification;
use App\Notifications\TaskAssignedNotification;
use App\Notifications\TaskCommentedNotification;
use App\Notifications\TaskCommentMentionNotification;
use App\Support\CurrentOrganization;
use Illuminate\Notifications\Events\NotificationSent;
use Illuminate\Support\Facades\Event;
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

it('skips the mail at execution when email was turned off after queueing', function () {
    $organization = Organization::factory()->create();
    $actor = User::factory()->create();
    $organization->addMember($actor, [Role::Member]);
    $organization->addMember($this->user, [Role::Member]);
    $project = Project::factory()->for($organization)->create(['key' => 'POSVE']);
    assignMembersToAllProjects();
    app(CurrentOrganization::class)->set($organization);
    $task = tap(new Task(['title' => 'T', 'status' => 'todo', 'position' => 1.0]), function (Task $task) use ($project) {
        $task->project_id = $project->id;
        $task->number = 1;
        $task->assignee_id = $this->user->id;
        $task->save();
        $task->setRelation('project', $project);
    });
    $notification = TaskAssignedNotification::for($task, $actor);
    $this->user->update(['notification_preferences' => ['email' => ['task_assigned' => false]]]);
    Event::fake([NotificationSent::class]);

    $this->user->notifyNow($notification);

    $sent = Event::dispatched(NotificationSent::class)->map(fn (array $args) => $args[0]->channel)->sort()->values()->all();
    expect($sent)->toBe([AppChannel::class])->and(AppNotification::query()->where('user_id', $this->user->id)->count())->toBe(1);
});

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
