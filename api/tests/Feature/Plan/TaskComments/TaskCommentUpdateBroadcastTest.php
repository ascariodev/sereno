<?php

use App\Enums\Role;
use App\Events\TaskCommentUpdated;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
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
    $this->comment = TaskComment::factory()->forTask($this->task)->create(['user_id' => $this->member->id, 'body' => 'Original']);
    $this->channel = "private-organizations.{$this->organization->id}.projects.{$this->project->id}";
});

function broadcastUpdateCall(object $test, array $payload)
{
    Sanctum::actingAs($test->member);

    return test()->withHeader('X-Organization-Id', (string) $test->organization->id)
        ->patchJson("/api/projects/{$test->project->id}/tasks/{$test->task->id}/comments/{$test->comment->id}", $payload);
}

it('broadcasts the edited comment with the same shape as the response', function () {
    Event::fake([TaskCommentUpdated::class]);
    $mentioned = User::factory()->create(['name' => 'Ana']);
    $this->organization->addMember($mentioned, [Role::Member]);
    $this->project->addMember($mentioned);

    $response = broadcastUpdateCall($this, ['body' => "Changed <@{$mentioned->id}>"])->assertOk();

    Event::assertDispatchedTimes(TaskCommentUpdated::class, 1);
    Event::assertDispatched(TaskCommentUpdated::class, function (TaskCommentUpdated $event) use ($response) {
        $comment = json_decode(json_encode($event->broadcastWith()['comment']), true);

        return $event->broadcastOn()->name === $this->channel
            && $event->broadcastAs() === 'task.comment.updated'
            && array_keys($event->broadcastWith()) === ['comment']
            && $comment['edited_at'] !== null
            && $comment === $response->json('data');
    });
});

it('does not broadcast when validation fails', function () {
    Event::fake([TaskCommentUpdated::class]);

    broadcastUpdateCall($this, ['body' => ''])->assertUnprocessable();

    Event::assertNotDispatched(TaskCommentUpdated::class);
});
