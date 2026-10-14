<?php

use App\Enums\NotificationType;
use App\Events\NotificationCreated;
use App\Jobs\SendPushNotification;
use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\Project;
use App\Models\PushSubscription;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Notifications\Contracts\RevalidatesAfterInsert;
use App\Support\PushSender;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

class FakePushSender implements PushSender
{
    /** @var list<list<string>> endpoints of each call */
    public array $calls = [];

    /** @var list<array<string, mixed>> */
    public array $payloads = [];

    /** @var array<string, string> outcome by endpoint, SENT when absent */
    public array $outcomes = [];

    public function send(iterable $subscriptions, string $payload): array
    {
        $this->calls[] = collect($subscriptions)->pluck('endpoint')->all();
        $this->payloads[] = json_decode($payload, true, flags: JSON_THROW_ON_ERROR);

        return collect($subscriptions)
            ->mapWithKeys(fn (PushSubscription $subscription) => [
                $subscription->id => $this->outcomes[$subscription->endpoint] ?? PushSender::SENT,
            ])
            ->all();
    }
}

class PushTestNotification extends Notification implements RevalidatesAfterInsert
{
    public function __construct(
        public readonly int $organizationId,
        public readonly int $projectId,
        public readonly Model $subject,
        public readonly bool $applies = true,
    ) {}

    /** @return list<class-string> */
    public function via(object $notifiable): array
    {
        return [AppChannel::class];
    }

    /** @return array<string, mixed> */
    public function toApp(User $notifiable): array
    {
        return [
            'type' => NotificationType::TaskAssigned->value,
            'organization_id' => $this->organizationId,
            'project_id' => $this->projectId,
            'subject' => $this->subject,
            'data' => ['task_id' => 9, 'task_key' => 'WEB-9', 'task_title' => 'Fix it', 'actor_name' => 'Ana'],
        ];
    }

    public function stillApplies(User $notifiable): bool
    {
        return $this->applies;
    }
}

beforeEach(function () {
    config([
        'workspace.push.vapid_public_key' => 'public',
        'workspace.push.vapid_private_key' => 'private',
        'workspace.push.vapid_subject' => 'mailto:ops@sereno.test',
    ]);
    $this->sender = new FakePushSender;
    app()->instance(PushSender::class, $this->sender);

    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    $this->user = User::factory()->create();
    $this->organization->users()->attach($this->user);
    $this->phone = PushSubscription::factory()->for($this->user)->create(['endpoint' => 'https://push.test/phone']);
    $this->laptop = PushSubscription::factory()->for($this->user)->create(['endpoint' => 'https://push.test/laptop']);
});

function pushNotificationRow(array $attributes = []): AppNotification
{
    $uuid = (string) Str::uuid();

    AppNotification::query()->withoutGlobalScopes()->insert([
        'uuid' => $uuid,
        'organization_id' => test()->organization->id,
        'user_id' => test()->user->id,
        'project_id' => test()->project->id,
        'type' => NotificationType::TaskAssigned->value,
        'subject_type' => test()->project->getMorphClass(),
        'subject_id' => test()->project->id,
        'data' => json_encode(['task_id' => 9, 'task_key' => 'WEB-9', 'task_title' => 'Fix it', 'actor_name' => 'Ana']),
        ...$attributes,
    ]);

    return AppNotification::query()->withoutGlobalScopes()->where('uuid', $uuid)->sole();
}

it('pushes to every subscription of the user and marks them as used', function () {
    PushSubscription::factory()->create(['endpoint' => 'https://push.test/stranger']);
    $row = pushNotificationRow();

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toBe([['https://push.test/phone', 'https://push.test/laptop']])
        ->and($this->sender->payloads[0]['uuid'])->toBe($row->uuid)
        ->and($this->sender->payloads[0]['title'])->toBe('Ana assigned you WEB-9')
        ->and($this->phone->fresh()->last_used_at)->not->toBeNull()
        ->and($this->laptop->fresh()->last_used_at)->not->toBeNull();
});

it('pushes nothing when the notification was read', function () {
    $row = pushNotificationRow(['read_at' => now()]);

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toBe([]);
});

it('pushes nothing when the notification was deleted', function () {
    $row = pushNotificationRow();
    AppNotification::query()->withoutGlobalScopes()->whereKey($row->id)->delete();

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toBe([]);
});

it('pushes nothing when the user turned push off for that type', function () {
    $row = pushNotificationRow();
    $this->user->forceFill(['notification_preferences' => ['push' => [NotificationType::TaskAssigned->value => false]]])->save();

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toBe([]);
});

it('still pushes when push is off only for other types', function () {
    $row = pushNotificationRow();
    $this->user->forceFill(['notification_preferences' => ['push' => [NotificationType::ChatMention->value => false]]])->save();

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toHaveCount(1);
});

it('does nothing for a user without subscriptions', function () {
    $row = pushNotificationRow();
    PushSubscription::query()->delete();

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toBe([]);
});

it('deletes the subscriptions that the push service reports as expired', function () {
    $this->sender->outcomes['https://push.test/phone'] = PushSender::EXPIRED;
    $row = pushNotificationRow();

    SendPushNotification::dispatchSync($row->uuid);

    expect(PushSubscription::query()->pluck('endpoint')->all())->toBe(['https://push.test/laptop'])
        ->and($this->laptop->fresh()->last_used_at)->not->toBeNull();
});

it('retries only the subscriptions that failed, up to the attempt limit', function () {
    Log::spy();
    $this->sender->outcomes['https://push.test/laptop'] = PushSender::FAILED;
    $row = pushNotificationRow();

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toBe([
        ['https://push.test/phone', 'https://push.test/laptop'],
        ['https://push.test/laptop'],
        ['https://push.test/laptop'],
    ])->and(PushSubscription::query()->count())->toBe(2);
    Log::shouldHaveReceived('warning')->withArgs(fn (string $message) => str_contains($message, 'gave up'))->once();
});

it('delays the retry of the failed subscriptions', function () {
    Queue::fake();
    $this->sender->outcomes['https://push.test/laptop'] = PushSender::FAILED;
    $row = pushNotificationRow();

    (new SendPushNotification($row->uuid))->handle($this->sender);

    Queue::assertPushed(SendPushNotification::class, fn (SendPushNotification $job) => $job->notificationUuid === $row->uuid
        && $job->subscriptionIds === [$this->laptop->id]
        && $job->attempt === 2
        && $job->delay === SendPushNotification::RETRY_DELAYS[0]);
});

it('does not retry the subscriptions that the push service rejected', function () {
    $this->sender->outcomes['https://push.test/laptop'] = PushSender::REJECTED;
    $row = pushNotificationRow();

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toHaveCount(1)
        ->and(PushSubscription::query()->count())->toBe(2);
});

it('pushes nothing and says which setting is missing when Web Push is not configured', function () {
    Log::spy();
    config(['workspace.push.vapid_subject' => null]);
    $row = pushNotificationRow();

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toBe([]);
    Log::shouldHaveReceived('warning')->withArgs(fn (string $message) => str_contains($message, 'VAPID_SUBJECT')
        && ! str_contains($message, 'VAPID_PUBLIC_KEY'))->once();
});

it('skips a notification whose payload cannot be built', function () {
    Log::spy();
    $row = pushNotificationRow(['data' => json_encode(['task_id' => 9])]);

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toBe([]);
    Log::shouldHaveReceived('warning')->withArgs(fn (string $message, array $context) => $context['notification'] === $row->uuid)->once();
});

it('skips a notification of an unknown type without pushing', function () {
    Log::spy();
    $this->user->forceFill(['notification_preferences' => ['push' => ['mystery' => false]]])->save();
    $row = pushNotificationRow(['type' => 'mystery']);

    SendPushNotification::dispatchSync($row->uuid);

    expect($this->sender->calls)->toBe([]);
    Log::shouldHaveReceived('warning')->withArgs(fn (string $message, array $context) => str_contains($message, 'unknown type')
        && $context['notification'] === $row->uuid)->once();
});

it('queues the push once the app channel stores the notification', function () {
    Queue::fake([SendPushNotification::class]);
    $notification = new PushTestNotification($this->organization->id, $this->project->id, $this->project);
    $notification->id = (string) Str::uuid();

    $this->user->notify($notification);
    $this->user->notify($notification);

    Queue::assertPushed(SendPushNotification::class, 1);
    Queue::assertPushed(SendPushNotification::class, fn (SendPushNotification $job) => $job->notificationUuid === $notification->id
        && $job->subscriptionIds === null);
});

it('pushes through the app channel to the devices of the user', function () {
    $this->user->notify(new PushTestNotification($this->organization->id, $this->project->id, $this->project));

    expect($this->sender->calls)->toBe([['https://push.test/phone', 'https://push.test/laptop']]);
});

it('does not queue the push when the notification no longer applies after the insert', function () {
    Queue::fake([SendPushNotification::class]);

    $this->user->notify(new PushTestNotification($this->organization->id, $this->project->id, $this->project, applies: false));

    expect(AppNotification::query()->withoutGlobalScopes()->count())->toBe(0);
    Queue::assertNotPushed(SendPushNotification::class);
});

it('keeps the notification when queueing the push fails', function () {
    Exceptions::fake();
    Event::fake([NotificationCreated::class]);
    Queue::shouldReceive('connection')->andThrow(new RuntimeException('queue down'));

    $this->user->notify(new PushTestNotification($this->organization->id, $this->project->id, $this->project));

    expect(AppNotification::query()->withoutGlobalScopes()->count())->toBe(1);
    Event::assertDispatched(NotificationCreated::class);
    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === 'queue down');
});
