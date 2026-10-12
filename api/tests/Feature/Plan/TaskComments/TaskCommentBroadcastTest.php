<?php

use App\Enums\Role;
use App\Events\TaskCommentCreated;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->addMember($this->member);
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $this->task->project_id = $this->project->id;
    $this->task->number = 1;
    $this->task->save();
    $this->channel = "private-organizations.{$this->organization->id}.projects.{$this->project->id}";
});

function broadcastCommentCall(object $test, array $payload)
{
    Sanctum::actingAs($test->member);

    return test()->withHeader('X-Organization-Id', (string) $test->organization->id)
        ->postJson("/api/projects/{$test->project->id}/tasks/{$test->task->id}/comments", $payload);
}

it('broadcasts the created comment with the same shape as the response', function () {
    Event::fake([TaskCommentCreated::class]);

    $response = broadcastCommentCall($this, ['body' => 'Hello'])->assertCreated();

    Event::assertDispatchedTimes(TaskCommentCreated::class, 1);
    Event::assertDispatched(TaskCommentCreated::class, function (TaskCommentCreated $event) use ($response) {
        $comment = $event->broadcastWith()['comment'];

        return $event->broadcastOn()->name === $this->channel
            && $event->broadcastAs() === 'task.comment.created'
            && $comment['user']['id'] === $this->member->id
            && json_decode(json_encode($comment), true) === $response->json('data');
    });
});

it('does not broadcast when validation fails', function () {
    Event::fake([TaskCommentCreated::class]);

    broadcastCommentCall($this, ['body' => ''])->assertUnprocessable();

    Event::assertNotDispatched(TaskCommentCreated::class);
});

it('broadcasts the mentions like the response', function () {
    Event::fake([TaskCommentCreated::class]);
    $mentioned = User::factory()->create(['name' => 'Ana']);
    $this->organization->addMember($mentioned, [Role::Member]);
    $this->project->addMember($mentioned);

    $response = broadcastCommentCall($this, ['body' => "Hi <@{$mentioned->id}>"])->assertCreated();

    Event::assertDispatched(TaskCommentCreated::class, function (TaskCommentCreated $event) use ($mentioned, $response) {
        $comment = json_decode(json_encode($event->broadcastWith()['comment']), true);

        return $comment['mentions'] === [['id' => $mentioned->id, 'name' => 'Ana']]
            && $comment === $response->json('data');
    });
});

it('broadcasts the task comment count including the new comment', function () {
    $this->task->comments()->make(['body' => 'First'])->forceFill(['user_id' => $this->member->id])->save();
    Event::fake([TaskCommentCreated::class]);

    broadcastCommentCall($this, ['body' => 'Second'])->assertCreated();

    Event::assertDispatched(TaskCommentCreated::class, fn (TaskCommentCreated $event) => $event->broadcastWith()['comments_count'] === 2);
});
