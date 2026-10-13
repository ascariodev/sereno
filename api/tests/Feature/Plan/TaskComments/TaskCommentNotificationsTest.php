<?php

use App\Enums\Locale;
use App\Enums\NotificationType;
use App\Enums\Role;
use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Notifications\Channels\AppChannel;
use App\Notifications\TaskCommentedNotification;
use App\Notifications\TaskCommentMentionNotification;
use App\Support\CurrentOrganization;
use Illuminate\Notifications\Events\NotificationSent;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->author = User::factory()->create(['name' => 'Ana']);
    $this->assignee = User::factory()->create(['locale' => Locale::Es]);
    $this->creator = User::factory()->create();
    $this->mentioned = User::factory()->create();
    foreach ([$this->author, $this->assignee, $this->creator, $this->mentioned] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'POSVE']);
    assignMembersToAllProjects();
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $this->task->project_id = $this->project->id;
    $this->task->number = 3;
    $this->task->assignee_id = $this->assignee->id;
    $this->task->created_by = $this->creator->id;
    $this->task->save();
});

function commentOnTask(string $body, ?User $as = null)
{
    Sanctum::actingAs($as ?? test()->author);

    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)
        ->postJson('/api/projects/'.test()->project->id.'/tasks/'.test()->task->id.'/comments', ['body' => $body]);
}

it('notifies mentioned users, the assignee and the creator without duplicates', function () {
    Notification::fake();

    commentOnTask("Hi <@{$this->mentioned->id}> and <@{$this->assignee->id}>")->assertCreated();

    Notification::assertSentToTimes($this->mentioned, TaskCommentMentionNotification::class, 1);
    Notification::assertSentToTimes($this->assignee, TaskCommentMentionNotification::class, 1);
    Notification::assertNotSentTo($this->assignee, TaskCommentedNotification::class);
    Notification::assertSentToTimes($this->creator, TaskCommentedNotification::class, 1);
    Notification::assertNotSentTo($this->mentioned, TaskCommentedNotification::class);
    Notification::assertNothingSentTo($this->author);
});

it('does not notify the author who is also the assignee or creator', function () {
    Notification::fake();

    commentOnTask('Plain', $this->assignee)->assertCreated();

    Notification::assertNothingSentTo($this->assignee);
    Notification::assertSentToTimes($this->creator, TaskCommentedNotification::class, 1);
});

it('stores the rows with ids and a short excerpt where the mention shows the name', function () {
    commentOnTask("Look <@{$this->mentioned->id}>   now\n".str_repeat('x', 300))->assertCreated();

    $comment = TaskComment::query()->sole();
    $mention = AppNotification::query()->where('user_id', $this->mentioned->id)->sole();
    $commented = AppNotification::query()->where('user_id', $this->assignee->id)->sole();

    expect($mention->type)->toBe(NotificationType::TaskCommentMention->value)
        ->and($commented->type)->toBe(NotificationType::TaskCommented->value)
        ->and($mention->project_id)->toBe($this->project->id)
        ->and($mention->subject_type)->toBe(TaskComment::class)
        ->and($mention->subject_id)->toBe($comment->id)
        ->and(collect($mention->data)->keys()->sort()->values()->all())->toBe(
            ['actor_id', 'actor_name', 'comment_excerpt', 'comment_id', 'task_id', 'task_key', 'task_title'],
        )
        ->and($mention->data['task_key'])->toBe('POSVE-3')
        ->and($mention->data['comment_id'])->toBe($comment->id)
        ->and($mention->data['comment_excerpt'])->toStartWith('Look @'.$this->mentioned->name.' now xxx')
        ->and(mb_strlen($mention->data['comment_excerpt']))->toBeLessThanOrEqual(143);
});

it('sends the mail in the recipient locale with the task link', function () {
    $notification = new TaskCommentedNotification(
        $this->organization->id, $this->project->id, 7, 'POSVE-3', 'Fix it', 1, 'Hello', $this->author->id, 'Ana',
    );
    $previous = App::getLocale();
    App::setLocale($this->assignee->preferredLocale());
    $mail = $notification->toMail($this->assignee);
    App::setLocale($previous);

    expect($mail->subject)->toBe('Ana comentó en POSVE-3')
        ->and($mail->actionUrl)->toBe(config('app.frontend_url')."/projects/{$this->project->id}/plan?task=7");
});

function commentNotificationsSent(): array
{
    return Event::dispatched(NotificationSent::class)->map(fn (array $args) => $args[0]->channel)->sort()->values()->all();
}

function mentionNotificationFor(User $user): TaskCommentMentionNotification
{
    $comment = tap(new TaskComment(['body' => 'x']), function (TaskComment $comment) {
        $comment->task_id = test()->task->id;
        $comment->user_id = test()->author->id;
        $comment->save();
    });
    DB::table('task_comment_mentions')->insert([
        'organization_id' => test()->organization->id, 'task_comment_id' => $comment->id,
        'user_id' => $user->id, 'created_at' => now(),
    ]);
    Event::fake([NotificationSent::class]);

    return new TaskCommentMentionNotification(
        test()->organization->id, test()->project->id, test()->task->id, 'POSVE-3', 'Fix it',
        $comment->id, 'x', test()->author->id, 'Ana',
    );
}

it('sends the app and mail channels while the mention still holds at execution', function () {
    $notification = mentionNotificationFor($this->mentioned);

    $this->mentioned->notifyNow($notification);

    expect(AppNotification::query()->count())->toBe(1)
        ->and(commentNotificationsSent())->toBe([AppChannel::class, 'mail']);
});

it('does not send a mention when the comment was deleted, the mention removed or access lost', function (string $change) {
    $notification = mentionNotificationFor($this->mentioned);
    match ($change) {
        'comment' => TaskComment::query()->whereKey($notification->commentId)->delete(),
        'mention' => DB::table('task_comment_mentions')->where('task_comment_id', $notification->commentId)->delete(),
        'access' => $this->project->removeMember($this->mentioned),
    };

    $this->mentioned->notifyNow($notification);

    expect(AppNotification::query()->count())->toBe(0)->and(commentNotificationsSent())->toBe([]);
})->with(['comment', 'mention', 'access']);

it('does not send a comment notice when the user is no longer assignee or creator, or lost access', function (string $change) {
    $notification = mentionNotificationFor($this->mentioned);
    $commented = new TaskCommentedNotification(
        $this->organization->id, $this->project->id, $this->task->id, 'POSVE-3', 'Fix it',
        $notification->commentId, 'x', $this->author->id, 'Ana',
    );
    match ($change) {
        'reassigned' => $this->task->forceFill(['assignee_id' => $this->mentioned->id])->save(),
        'access' => $this->project->removeMember($this->assignee),
        'comment' => TaskComment::query()->whereKey($notification->commentId)->delete(),
    };

    $this->assignee->notifyNow($commented);

    expect(AppNotification::query()->count())->toBe(0)->and(commentNotificationsSent())->toBe([]);
})->with(['reassigned', 'access', 'comment']);

it('renders the comment excerpt in the mail as plain text, not markdown', function (string $class) {
    $notification = new $class(
        $this->organization->id, $this->project->id, 7, 'POSVE-3', 'Fix it', 1, '[x](http://evil.test) **b**', $this->author->id, 'Ana',
    );

    $html = (string) $notification->toMail($this->assignee)->render();

    expect($html)->toContain('[x](http://evil.test) **b**')
        ->not->toContain('href="http://evil.test"')
        ->not->toContain('<strong>b</strong>');
})->with([TaskCommentedNotification::class, TaskCommentMentionNotification::class]);
