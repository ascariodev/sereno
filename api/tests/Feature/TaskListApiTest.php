<?php

use App\Enums\Role;
use App\Enums\TaskStatus;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'POSVE']);
    assignMembersToAllProjects();
});

function listTasksAs(User $user, Organization $organization, Project $project)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->getJson("/api/projects/{$project->id}/tasks");
}

function seedListedTask(Project $project, int $number, array $attributes = []): Task
{
    app(CurrentOrganization::class)->set($project->organization);

    $task = new Task($attributes + ['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = $number;
    $task->log_group_id = $attributes['log_group_id'] ?? null;
    $task->save();

    return $task;
}

it('lists every task ordered by column and position with the resource shape', function () {
    $group = LogGroup::factory()->for($this->project)->create(['events_count' => 7]);
    $done = seedListedTask($this->project, 1, ['status' => TaskStatus::Done, 'position' => 1.0]);
    $reviewB = seedListedTask($this->project, 2, ['status' => TaskStatus::InReview, 'position' => 2.0]);
    $reviewA = seedListedTask($this->project, 3, ['status' => TaskStatus::InReview, 'position' => 1.0]);
    $progress = seedListedTask($this->project, 4, ['status' => TaskStatus::InProgress, 'position' => 5.0]);
    $todo = seedListedTask($this->project, 5, [
        'position' => 9.0,
        'log_group_id' => $group->id,
    ]);
    $todo->assignee_id = $this->member->id;
    $todo->save();

    $response = listTasksAs($this->member, $this->organization, $this->project)->assertOk();

    expect(collect($response->json('data'))->pluck('id')->all())
        ->toBe([$todo->id, $progress->id, $reviewA->id, $reviewB->id, $done->id]);

    $response->assertJsonPath('data.0.key', 'POSVE-5')
        ->assertJsonPath('data.0.number', 5)
        ->assertJsonPath('data.0.status', 'todo')
        ->assertJsonPath('data.0.assignee.id', $this->member->id)
        ->assertJsonPath('data.0.assignee.name', $this->member->name)
        ->assertJsonPath('data.0.log_group.id', $group->id)
        ->assertJsonPath('data.0.log_group.events_count', 7)
        ->assertJsonPath('data.1.assignee', null)
        ->assertJsonPath('data.1.log_group', null);
    expect($response->json('data.0.log_group'))->toHaveKeys(['id', 'level', 'title', 'status', 'events_count']);
});

it('does not run queries per task', function () {
    foreach (range(1, 2) as $number) {
        $group = LogGroup::factory()->for($this->project)->create();
        seedListedTask($this->project, $number, ['log_group_id' => $group->id])
            ->forceFill(['assignee_id' => $this->member->id])->save();
    }
    listTasksAs($this->member, $this->organization, $this->project)->assertOk();

    $count = function () {
        DB::flushQueryLog();
        DB::enableQueryLog();
        listTasksAs($this->member, $this->organization, $this->project)->assertOk();

        return count(DB::getQueryLog());
    };
    $few = $count();

    foreach (range(3, 8) as $number) {
        $group = LogGroup::factory()->for($this->project)->create();
        seedListedTask($this->project, $number, ['log_group_id' => $group->id])
            ->forceFill(['assignee_id' => $this->member->id])->save();
    }

    expect($count())->toBe($few);
});

it('only lists tasks of the requested project', function () {
    $mine = seedListedTask($this->project, 1);
    $sibling = Project::factory()->for($this->organization)->create();
    seedListedTask($sibling, 1);

    listTasksAs($this->member, $this->organization, $this->project)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $mine->id);
});

it('hides the tasks from another organization', function () {
    seedListedTask($this->project, 1);

    listTasksAs($this->outsider, $this->other, $this->project)->assertNotFound();
    listTasksAs($this->outsider, $this->organization, $this->project)->assertStatus(403);
});

it('requires authentication', function () {
    $this->getJson("/api/projects/{$this->project->id}/tasks")->assertUnauthorized();
});

it('keeps listing the whole Done column without done_limit', function () {
    foreach ([1, 2, 3] as $n) {
        seedListedTask($this->project, $n, ['status' => TaskStatus::Done, 'position' => (float) $n]);
    }

    listTasksAs($this->member, $this->organization, $this->project)
        ->assertOk()
        ->assertJsonCount(3, 'data')
        ->assertJsonPath('meta.done_total', 3)
        ->assertJsonPath('meta.has_more_done', false);
});

it('limits the Done column to its latest tasks by position and keeps the other columns whole', function () {
    $todo = seedListedTask($this->project, 1, ['position' => 1.0]);
    $late = seedListedTask($this->project, 2, ['status' => TaskStatus::Done, 'position' => 3.0]);
    seedListedTask($this->project, 6, ['status' => TaskStatus::Done, 'position' => 0.5]);
    seedListedTask($this->project, 3, ['status' => TaskStatus::Done, 'position' => 1.0]);
    $second = seedListedTask($this->project, 4, ['status' => TaskStatus::Done, 'position' => 2.0]);
    $review = seedListedTask($this->project, 5, ['status' => TaskStatus::InReview, 'position' => 1.0]);

    Sanctum::actingAs($this->member);
    $response = $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->getJson("/api/projects/{$this->project->id}/tasks?done_limit=2")
        ->assertOk();

    expect(collect($response->json('data'))->pluck('id')->all())
        ->toBe([$todo->id, $review->id, $second->id, $late->id]);
    $response->assertJsonPath('meta.done_total', 4)->assertJsonPath('meta.has_more_done', true);

    $this->getJson("/api/projects/{$this->project->id}/tasks?done_limit=4")
        ->assertOk()
        ->assertJsonCount(6, 'data')
        ->assertJsonPath('meta.has_more_done', false);
});

it('rejects an invalid done_limit', function () {
    Sanctum::actingAs($this->member);

    foreach (['0', 'abc', '501'] as $value) {
        $this->withHeader('X-Organization-Id', (string) $this->organization->id)
            ->getJson("/api/projects/{$this->project->id}/tasks?done_limit={$value}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('done_limit');
    }
});

function showTaskAs(User $user, Organization $organization, Project $project, Task $task)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->getJson("/api/projects/{$project->id}/tasks/{$task->id}");
}

it('shows a single task with the resource shape', function () {
    $task = seedListedTask($this->project, 1, ['status' => TaskStatus::Done]);

    showTaskAs($this->member, $this->organization, $this->project, $task)
        ->assertOk()
        ->assertJsonPath('data.id', $task->id)
        ->assertJsonPath('data.key', 'POSVE-1')
        ->assertJsonPath('data.status', 'done');
});

it('does not show a task through another project or organization', function () {
    $task = seedListedTask($this->project, 1);
    $sibling = Project::factory()->for($this->organization)->create(['key' => 'OTHER']);
    assignMembersToAllProjects();

    showTaskAs($this->member, $this->organization, $sibling, $task)->assertNotFound();
    showTaskAs($this->outsider, $this->other, $this->project, $task)->assertNotFound();
    showTaskAs($this->outsider, $this->organization, $this->project, $task)->assertForbidden();
});

it('hides a single task from a member not assigned to its project', function () {
    $task = seedListedTask($this->project, 1);
    DB::table('project_user')->where('project_id', $this->project->id)->where('user_id', $this->member->id)->delete();

    showTaskAs($this->member, $this->organization, $this->project, $task)->assertNotFound();
});
