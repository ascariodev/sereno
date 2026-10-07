<?php

use App\Enums\LogGroupStatus;
use App\Events\LogGroupOpened;
use App\Events\LogGroupReopened;
use App\Events\MessageCreated;
use App\Listeners\PostLogGroupNotice;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\LogSource;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Support\CurrentOrganization;
use App\Support\LogEventRecorder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create();
    $this->source = LogSource::factory()->for($this->project)->create();
    $this->otherProject = Project::factory()->for($this->organization)->create();
    $this->otherChannel = Channel::factory()->for($this->otherProject)->create();
});

function noticeMessages(): array
{
    return Message::withoutGlobalScopes()->orderBy('id')->get()->all();
}

function ingestNotice(LogSource $source, string $message = 'Order failed'): void
{
    app(LogEventRecorder::class)->record($source, ['level' => 'error', 'message' => $message]);
}

it('posts a system notice in the project channel when a group opens', function () {
    ingestNotice($this->source);

    $messages = noticeMessages();
    $group = LogGroup::withoutGlobalScopes()->firstOrFail();

    expect($messages)->toHaveCount(1)
        ->and($messages[0]->channel_id)->toBe($this->channel->id)
        ->and($messages[0]->organization_id)->toBe($this->organization->id)
        ->and($messages[0]->kind)->toBe('system')
        ->and($messages[0]->user_id)->toBeNull()
        ->and($messages[0]->body)->toBeNull()
        ->and($messages[0]->log_group_id)->toBe($group->id)
        ->and($messages[0]->payload)->toEqual([
            'type' => 'log.group_opened',
            'log_group_id' => $group->id,
            'level' => 'error',
            'title' => $group->title,
            'events_count' => 1,
        ]);
});

it('does not post again for a repeated event', function () {
    ingestNotice($this->source);
    ingestNotice($this->source);

    expect(noticeMessages())->toHaveCount(1);
});

it('posts a reopened notice on regression and not for ignored groups', function () {
    ingestNotice($this->source);
    $group = LogGroup::withoutGlobalScopes()->firstOrFail();

    $group->forceFill(['status' => LogGroupStatus::Resolved])->save();
    ingestNotice($this->source);

    $group->forceFill(['status' => LogGroupStatus::Ignored])->save();
    ingestNotice($this->source);

    $messages = noticeMessages();

    expect($messages)->toHaveCount(2)
        ->and($messages[1]->payload['type'])->toBe('log.group_reopened')
        ->and($messages[1]->payload['events_count'])->toBe(2)
        ->and($messages[1]->log_group_id)->toBe($group->id);
});

it('runs through the real queue worker without an active organization and broadcasts the message', function () {
    config(['queue.default' => 'database']);
    Event::fake([MessageCreated::class]);
    app(CurrentOrganization::class)->set(null);

    ingestNotice($this->source);

    expect(DB::table('jobs')->count())->toBe(1)
        ->and(noticeMessages())->toBeEmpty();

    Artisan::call('queue:work', ['--once' => true, '--stop-when-empty' => true]);

    $messages = noticeMessages();

    expect($messages)->toHaveCount(1)
        ->and($messages[0]->kind)->toBe('system')
        ->and($messages[0]->channel_id)->toBe($this->channel->id)
        ->and(DB::table('failed_jobs')->count())->toBe(0)
        ->and(DB::table('jobs')->count())->toBe(0);
    Event::assertDispatchedTimes(MessageCreated::class, 1);
});

it('does not cross tenants or projects and skips missing or archived channels', function () {
    ingestNotice($this->source);
    $group = LogGroup::withoutGlobalScopes()->firstOrFail();
    Message::withoutGlobalScopes()->delete();

    $foreign = Organization::factory()->create();
    $listener = app(PostLogGroupNotice::class);

    $listener->handle(new LogGroupOpened($foreign->id, $this->project->id, $group->id, 'error', 'T', 1));
    $listener->handle(new LogGroupReopened($this->organization->id, $this->otherProject->id, $group->id, 'error', 'T', 1));
    $listener->handle(new LogGroupOpened($this->organization->id, $this->project->id, 999999, 'error', 'T', 1));
    $this->channel->forceFill(['archived_at' => now()])->save();
    $listener->handle(new LogGroupOpened($this->organization->id, $this->project->id, $group->id, 'error', 'T', 1));

    expect(noticeMessages())->toBeEmpty();
});
