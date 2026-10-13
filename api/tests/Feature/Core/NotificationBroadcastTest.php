<?php

use App\Enums\Role;
use App\Events\NotificationCreated;
use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Support\CurrentOrganization;
use Illuminate\Broadcasting\BroadcastEvent;
use Illuminate\Contracts\Broadcasting\Broadcaster;
use Illuminate\Contracts\Broadcasting\Factory as BroadcastingFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;

class NotificationBroadcastTestNotice extends Notification
{
    public function __construct(
        public readonly int $organizationId,
        public readonly ?int $projectId,
        public readonly Model $subject,
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
            'type' => 'test_notice',
            'organization_id' => $this->organizationId,
            'project_id' => $this->projectId,
            'subject' => $this->subject,
            'data' => ['title' => 'Hello'],
        ];
    }
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->ana = User::factory()->create();
    $this->organization->addMember($this->ana, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->ana);
    app(CurrentOrganization::class)->set($this->organization);
    Event::fake([NotificationCreated::class]);
});

function notifyAna(object $test, ?Project $project, ?string $uuid = null): void
{
    $notice = new NotificationBroadcastTestNotice($test->organization->id, $project?->id, $test->project);
    if ($uuid !== null) {
        $notice->id = $uuid;
    }
    $test->ana->notify($notice);
}

function broadcastJob(): BroadcastEvent
{
    return unserialize(serialize(new BroadcastEvent(Event::dispatched(NotificationCreated::class)->first()[0])));
}

function runJob(BroadcastEvent $job, ?Closure $expect = null): void
{
    $broadcaster = Mockery::mock(Broadcaster::class);
    if ($expect === null) {
        $broadcaster->shouldNotReceive('broadcast');
    } else {
        $broadcaster->shouldReceive('broadcast')->once()->withArgs($expect);
    }
    $manager = Mockery::mock(BroadcastingFactory::class);
    $manager->shouldReceive('connection')->andReturn($broadcaster);
    $job->handle($manager);
}

it('emits notification.created on the private channel of the user with the inbox payload', function () {
    notifyAna($this, $this->project);

    $row = AppNotification::query()->sole();
    Event::assertDispatchedTimes(NotificationCreated::class, 1);
    Event::assertDispatched(NotificationCreated::class, function (NotificationCreated $e) use ($row) {
        $payload = $e->broadcastWith();

        return $e->broadcastOn()->name === "private-users.{$this->ana->id}"
            && $e->broadcastAs() === 'notification.created'
            && array_keys($payload) === ['organization_id', 'notification']
            && $payload['organization_id'] === $this->organization->id
            && array_keys($payload['notification']) === ['id', 'type', 'project_id', 'data', 'read_at', 'created_at']
            && $payload['notification']['id'] === $row->id
            && $payload['notification']['type'] === 'test_notice'
            && $payload['notification']['project_id'] === $this->project->id
            && (array) $payload['notification']['data'] === ['title' => 'Hello']
            && $payload['notification']['read_at'] === null;
    });
});

it('does not emit again when the same notification is delivered twice', function () {
    $uuid = (string) Str::uuid();
    notifyAna($this, $this->project, $uuid);
    notifyAna($this, $this->project, $uuid);

    Event::assertDispatchedTimes(NotificationCreated::class, 1);
});

it('survives queue serialization without an active organization', function () {
    notifyAna($this, $this->project);
    $event = Event::dispatched(NotificationCreated::class)->first()[0];

    app(CurrentOrganization::class)->set(null);
    $restored = unserialize(serialize($event));

    expect($restored->broadcastOn()->name)->toBe($event->broadcastOn()->name)
        ->and($restored->broadcastWith())->toEqual($event->broadcastWith());
});

it('broadcasts a notification without project to a member', function () {
    notifyAna($this, null);
    $job = broadcastJob();

    app(CurrentOrganization::class)->set(null);
    runJob($job, fn (array $channels, string $name) => $name === 'notification.created'
        && $channels[0]->name === "private-users.{$this->ana->id}");
});

it('is not broadcast when the member leaves between the dispatch and the queued handle', function () {
    notifyAna($this, $this->project);
    $job = broadcastJob();

    app(CurrentOrganization::class)->set(null);
    $this->organization->removeMember($this->ana);

    runJob($job);
});

it('is not broadcast when the member loses the project between the dispatch and the queued handle', function () {
    notifyAna($this, $this->project);
    $job = broadcastJob();

    app(CurrentOrganization::class)->set(null);
    $this->project->removeMember($this->ana);

    runJob($job);
});

it('is broadcast to an admin who is not assigned to the project', function () {
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);
    $admin->notify(new NotificationBroadcastTestNotice($this->organization->id, $this->project->id, $this->project));
    $job = broadcastJob();

    app(CurrentOrganization::class)->set(null);
    runJob($job, fn (array $channels) => $channels[0]->name === "private-users.{$admin->id}");
});
