<?php

use App\Models\AppNotification;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Support\CurrentOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Notifications\Notification;

class AppChannelTestNotification extends Notification
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
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->message = Message::factory()->for(Channel::factory()->for($this->project))->create();
    $this->user = User::factory()->create();
});

it('stores the notification with its organization, project and subject', function () {
    app(CurrentOrganization::class)->set(null);

    $this->user->notify(new AppChannelTestNotification($this->organization->id, $this->project->id, $this->message));

    app(CurrentOrganization::class)->set($this->organization);
    $row = AppNotification::query()->sole();

    expect($row->organization_id)->toBe($this->organization->id)
        ->and($row->project_id)->toBe($this->project->id)
        ->and($row->user_id)->toBe($this->user->id)
        ->and($row->type)->toBe('test_notice')
        ->and($row->subject->is($this->message))->toBeTrue()
        ->and($row->data)->toBe(['title' => 'Hello'])
        ->and($row->read_at)->toBeNull()
        ->and($row->created_at)->not->toBeNull()
        ->and($row->uuid)->toBeString();
});

it('stores a notification without project', function () {
    $this->user->notify(new AppChannelTestNotification($this->organization->id, null, $this->message));

    expect(AppNotification::query()->sole()->project_id)->toBeNull();
});

it('does not duplicate the row when the same notification is delivered again', function () {
    $notification = new AppChannelTestNotification($this->organization->id, $this->project->id, $this->message);
    $notification->id = (string) Str::uuid();

    $this->user->notify($notification);
    $this->user->notify($notification);

    expect(AppNotification::query()->count())->toBe(1);
});

it('rejects a project from another organization', function () {
    $other = Project::factory()->for(Organization::factory())->create();

    $this->user->notify(new AppChannelTestNotification($this->organization->id, $other->id, $this->message));
})->throws(QueryException::class, 'notifications_project_organization_fk');

it('scopes notifications to the active organization', function () {
    $other = Organization::factory()->create();
    $this->user->notify(new AppChannelTestNotification($this->organization->id, null, $this->message));
    $this->user->notify(new AppChannelTestNotification($other->id, null, $this->message));

    expect(AppNotification::query()->pluck('organization_id')->all())->toBe([$this->organization->id]);
});

it('removes the notifications when their project is deleted', function () {
    $this->user->notify(new AppChannelTestNotification($this->organization->id, $this->project->id, $this->message));

    $this->project->delete();

    expect(AppNotification::query()->count())->toBe(0);
});
