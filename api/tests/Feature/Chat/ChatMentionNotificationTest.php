<?php

use App\Enums\Locale;
use App\Enums\NotificationType;
use App\Enums\Role;
use App\Models\AppNotification;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Notifications\ChatMentionNotification;
use Illuminate\Notifications\ChannelManager;
use Illuminate\Notifications\Events\NotificationSent;
use Illuminate\Notifications\SendQueuedNotifications;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    RateLimiter::clear('channel-messages');
    $this->organization = Organization::factory()->create();
    $this->author = User::factory()->create(['name' => 'Author']);
    $this->ana = User::factory()->create(['name' => 'Ana', 'locale' => Locale::Es]);
    $this->bob = User::factory()->create(['name' => 'Bob']);
    foreach ([$this->author, $this->ana, $this->bob] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create(['name' => 'POSVE']);
    assignMembersToAllProjects();
});

function chatMentionCall(string $method, string $uri, array $payload = [])
{
    Sanctum::actingAs(test()->author);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)->json($method, $uri, $payload);
}

function postChatMention(string $body, ?int $parentId = null, ?Channel $channel = null): Message
{
    $channel ??= test()->channel;
    $payload = array_filter(['body' => $body, 'parent_id' => $parentId], fn ($v) => $v !== null);

    return Message::query()->withoutGlobalScopes()->findOrFail(
        chatMentionCall('POST', "/api/channels/{$channel->id}/messages", $payload)->assertCreated()->json('data.id'),
    );
}

function chatMentionChannelsSent(): array
{
    return Event::dispatched(NotificationSent::class)->map(fn (array $args) => $args[0]->channel)->sort()->values()->all();
}

it('stores a row per mentioned user with ids and a short excerpt', function () {
    $message = postChatMention("Look <@{$this->ana->id}>   and <@{$this->bob->id}>\n".str_repeat('x', 300));

    $row = AppNotification::query()->withoutGlobalScopes()->where('user_id', $this->ana->id)->sole();

    expect(AppNotification::query()->withoutGlobalScopes()->count())->toBe(2)
        ->and($row->type)->toBe(NotificationType::ChatMention->value)
        ->and($row->organization_id)->toBe($this->organization->id)
        ->and($row->project_id)->toBe($this->project->id)
        ->and($row->subject_type)->toBe(Message::class)
        ->and($row->subject_id)->toBe($message->id)
        ->and(collect($row->data)->keys()->sort()->values()->all())->toBe(
            ['actor_id', 'actor_name', 'channel_id', 'channel_name', 'message_excerpt', 'message_id', 'parent_id'],
        )
        ->and($row->data['channel_id'])->toBe($this->channel->id)
        ->and($row->data['channel_name'])->toBe('POSVE')
        ->and($row->data['parent_id'])->toBeNull()
        ->and($row->data['actor_id'])->toBe($this->author->id)
        ->and($row->data['message_excerpt'])->toStartWith('Look @Ana and @Bob xxx')
        ->and(mb_strlen($row->data['message_excerpt']))->toBeLessThanOrEqual(143);
});

it('stores the thread root of a reply and links the mail to the thread', function () {
    $root = postChatMention('root');
    postChatMention("reply <@{$this->ana->id}>", $root->id);

    $row = AppNotification::query()->withoutGlobalScopes()->sole();
    $notification = new ChatMentionNotification(
        $this->organization->id, $this->project->id, $this->channel->id, 'POSVE', $row->subject_id, $root->id, 'x', $this->author->id, 'Author',
    );

    expect($row->data['parent_id'])->toBe($root->id)
        ->and($notification->toMail($this->ana)->actionUrl)
        ->toBe(config('app.frontend_url')."/channels/{$this->channel->id}?thread={$root->id}&organization={$this->organization->id}");
});

it('sends the mail in the recipient locale with the message link', function () {
    $notification = new ChatMentionNotification(
        $this->organization->id, $this->project->id, $this->channel->id, 'POSVE', 9, null, 'Hola', $this->author->id, 'Author',
    );
    $previous = App::getLocale();
    App::setLocale($this->ana->preferredLocale());
    $mail = $notification->toMail($this->ana);
    App::setLocale($previous);

    expect($mail->subject)->toBe('Author te mencionó en #POSVE')
        ->and($mail->actionUrl)->toBe(config('app.frontend_url')."/channels/{$this->channel->id}?message=9&organization={$this->organization->id}");
});

it('notifies in a channel without project with a null project_id', function () {
    $channel = Channel::factory()->create(['project_id' => null, 'organization_id' => $this->organization->id, 'name' => 'GENERAL']);

    postChatMention("hi <@{$this->bob->id}>", channel: $channel);

    expect(AppNotification::query()->withoutGlobalScopes()->sole()->project_id)->toBeNull();
});

it('deletes only the dropped mention rows when an edit removes a mention', function () {
    $message = postChatMention("hi <@{$this->ana->id}> <@{$this->bob->id}>");

    chatMentionCall('PATCH', "/api/channels/{$this->channel->id}/messages/{$message->id}", ['body' => "hi <@{$this->ana->id}>"])->assertOk();

    expect(AppNotification::query()->withoutGlobalScopes()->pluck('user_id')->all())->toBe([$this->ana->id]);
});

it('deletes the rows when the message is deleted', function () {
    $message = postChatMention("hi <@{$this->ana->id}> <@{$this->bob->id}>");

    chatMentionCall('DELETE', "/api/channels/{$this->channel->id}/messages/{$message->id}")->assertOk();

    expect(AppNotification::query()->withoutGlobalScopes()->count())->toBe(0);
});

function chatMentionNotificationFor(User $user, ?Channel $channel = null): ChatMentionNotification
{
    $channel ??= test()->channel;
    $message = Message::factory()->for($channel)->create(['user_id' => test()->author->id]);
    DB::table('message_mentions')->insert([
        'organization_id' => $channel->organization_id, 'message_id' => $message->id, 'user_id' => $user->id, 'created_at' => now(),
    ]);
    Event::fake([NotificationSent::class]);

    return new ChatMentionNotification(
        $channel->organization_id, $channel->project_id, $channel->id, $channel->name, $message->id, null, 'x', test()->author->id, 'Author',
    );
}

it('sends the app and mail channels while the mention still holds at execution', function () {
    $this->ana->notifyNow(chatMentionNotificationFor($this->ana));

    expect(AppNotification::query()->withoutGlobalScopes()->count())->toBe(1)
        ->and(chatMentionChannelsSent())->toBe([AppChannel::class, 'mail']);
});

it('does not send when the mention was removed or the access lost before the worker ran', function (string $change) {
    $notification = chatMentionNotificationFor($this->ana);
    match ($change) {
        'mention' => DB::table('message_mentions')->where('message_id', $notification->messageId)->delete(),
        'project' => $this->project->removeMember($this->ana),
        'organization' => $this->organization->removeMember($this->ana),
    };

    $this->ana->notifyNow($notification);

    expect(AppNotification::query()->withoutGlobalScopes()->count())->toBe(0)->and(chatMentionChannelsSent())->toBe([]);
})->with(['mention', 'project', 'organization']);

it('does not send in a channel without project once the user left the organization', function () {
    $channel = Channel::factory()->create(['project_id' => null, 'organization_id' => $this->organization->id, 'name' => 'GENERAL']);
    $notification = chatMentionNotificationFor($this->ana, $channel);
    $this->organization->removeMember($this->ana);

    $this->ana->notifyNow($notification);

    expect(AppNotification::query()->withoutGlobalScopes()->count())->toBe(0)->and(chatMentionChannelsSent())->toBe([]);
});

it('stores one row and sends one mail when a mention is removed and added back before the jobs run', function () {
    Event::fake([NotificationSent::class]);
    Queue::fake();
    $message = postChatMention("hi <@{$this->ana->id}>");
    $uri = "/api/channels/{$this->channel->id}/messages/{$message->id}";
    chatMentionCall('PATCH', $uri, ['body' => 'hi'])->assertOk();
    chatMentionCall('PATCH', $uri, ['body' => "hi again <@{$this->ana->id}>"])->assertOk();

    $jobs = Queue::pushed(SendQueuedNotifications::class);
    $jobs->each(fn (SendQueuedNotifications $job) => $job->handle(app(ChannelManager::class)));

    expect($jobs)->toHaveCount(4)
        ->and(AppNotification::query()->withoutGlobalScopes()->count())->toBe(1)
        ->and(chatMentionChannelsSent())->toBe([AppChannel::class, 'mail']);
});

it('renders the excerpt in the mail as plain text, not markdown', function () {
    $notification = new ChatMentionNotification(
        $this->organization->id, $this->project->id, $this->channel->id, 'POSVE', 9, null, '[x](http://evil.test) **b**', $this->author->id, 'Author',
    );

    $html = (string) $notification->toMail($this->ana)->render();

    expect($html)->toContain('[x](http://evil.test) **b**')
        ->not->toContain('href="http://evil.test"')
        ->not->toContain('<strong>b</strong>');
});
