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
