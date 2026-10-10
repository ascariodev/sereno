<?php

use App\Enums\Role;
use App\Events\TaskCreated;
use App\Events\TaskDeleted;
use App\Events\TaskUpdated;
use App\Models\LogGroup;
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
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'POSVE']);
    app(CurrentOrganization::class)->set($this->organization);
    $this->task = new Task(['title' => 'Old', 'status' => 'todo', 'position' => 1.0]);
    $this->task->project_id = $this->project->id;
    $this->task->number = 1;
    $this->task->created_by = $this->member->id;
    $this->task->save();
    $this->project->forceFill(['last_task_number' => 1])->save();
    $this->channel = "private-organizations.{$this->organization->id}.projects.{$this->project->id}";
});

function taskBroadcastCall(object $test, string $method, string $path, array $payload = [])
{
    Sanctum::actingAs($test->member);

    return test()->withHeader('X-Organization-Id', (string) $test->organization->id)
        ->json($method, "/api/projects/{$test->project->id}/tasks{$path}", $payload);
}

it('broadcasts the created task with the same shape as index', function () {
    Event::fake([TaskCreated::class]);
    $group = LogGroup::factory()->for($this->project)->create(['events_count' => 3]);

    $response = taskBroadcastCall($this, 'POST', '', [
        'title' => 'New', 'assignee_id' => $this->member->id, 'log_group_id' => $group->id,
    ])->assertCreated();

    Event::assertDispatchedTimes(TaskCreated::class, 1);
    Event::assertDispatched(TaskCreated::class, function (TaskCreated $event) use ($response, $group) {
        $task = $event->broadcastWith()['task'];

        return $event->broadcastOn()->name === $this->channel
            && $event->broadcastAs() === 'task.created'
            && $task['id'] === $response->json('data.id')
            && $task['key'] === 'POSVE-'.$task['number']
            && $task['assignee']['id'] === $this->member->id
            && $task['log_group']['id'] === $group->id
            && json_decode(json_encode($task), true) === $response->json('data');
    });
});

it('broadcasts an updated task', function () {
    Event::fake([TaskUpdated::class]);

    taskBroadcastCall($this, 'PATCH', "/{$this->task->id}", ['title' => 'Renamed'])->assertOk();

    Event::assertDispatchedTimes(TaskUpdated::class, 1);
    Event::assertDispatched(TaskUpdated::class, fn (TaskUpdated $event) => $event->broadcastOn()->name === $this->channel
        && $event->broadcastAs() === 'task.updated'
        && $event->broadcastWith()['task']['id'] === $this->task->id
        && $event->broadcastWith()['task']['title'] === 'Renamed'
        && $event->broadcastWith()['task']['key'] === 'POSVE-1');
});

it('broadcasts a move as an update with the new status and position', function () {
    Event::fake([TaskUpdated::class]);

    taskBroadcastCall($this, 'POST', "/{$this->task->id}/move", ['status' => 'done'])->assertOk();

    Event::assertDispatchedTimes(TaskUpdated::class, 1);
    Event::assertDispatched(TaskUpdated::class, fn (TaskUpdated $event) => $event->broadcastWith()['task']['id'] === $this->task->id
        && json_decode(json_encode($event->broadcastWith()), true)['task']['status'] === 'done'
        && $event->broadcastWith()['task']['position'] == 1);
});

it('broadcasts a deleted task with only ids', function () {
    Event::fake([TaskDeleted::class]);

    taskBroadcastCall($this, 'DELETE', "/{$this->task->id}")->assertNoContent();

    Event::assertDispatchedTimes(TaskDeleted::class, 1);
    Event::assertDispatched(TaskDeleted::class, fn (TaskDeleted $event) => $event->broadcastOn()->name === $this->channel
        && $event->broadcastAs() === 'task.deleted'
        && $event->broadcastWith() === ['id' => $this->task->id, 'project_id' => $this->project->id]);
});

it('does not broadcast when the operation fails with 422', function () {
    Event::fake([TaskCreated::class, TaskUpdated::class, TaskDeleted::class]);

    taskBroadcastCall($this, 'POST', '', ['title' => ''])->assertUnprocessable();
    taskBroadcastCall($this, 'PATCH', "/{$this->task->id}", ['title' => ''])->assertUnprocessable();
    taskBroadcastCall($this, 'POST', "/{$this->task->id}/move", ['status' => 'done', 'after_id' => 999999])->assertUnprocessable();

    Event::assertNotDispatched(TaskCreated::class);
    Event::assertNotDispatched(TaskUpdated::class);
    Event::assertNotDispatched(TaskDeleted::class);
});

it('does not broadcast a delete the policy refuses', function () {
    Event::fake([TaskDeleted::class]);
    $other = User::factory()->create();
    $this->organization->addMember($other, [Role::Member]);
    Sanctum::actingAs($other);

    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/projects/{$this->project->id}/tasks/{$this->task->id}")->assertForbidden();

    Event::assertNotDispatched(TaskDeleted::class);
});
