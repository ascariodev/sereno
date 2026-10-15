<?php

use App\Enums\NotificationType;
use App\Enums\Role;
use App\Events\TaskAssigned;
use App\Events\TaskCreated;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\CreateTaskTool;
use App\Models\AppNotification;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\Event;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->ana = User::factory()->create(['name' => 'Ana']);
    $this->outsider = User::factory()->create();
    foreach ([$this->member, $this->ana, $this->outsider] as $user) {
        $this->organization->addMember($user, [Role::Member]);
    }

    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->members()->attach([$this->member->id, $this->ana->id], ['organization_id' => $this->organization->id]);

    $this->call = function (User $user, array $arguments) {
        app(CurrentOrganization::class)->set($this->organization);

        return SerenoServer::actingAs($user)->tool(CreateTaskTool::class, $arguments);
    };

    app(CurrentOrganization::class)->set($this->organization);
});

it('creates the task, emits the event and numbers it', function () {
    Event::fake([TaskCreated::class]);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'title' => '  Fix login ',
        'description' => 'Details',
        'status' => 'in_progress',
    ])
        ->assertOk()
        ->assertStructuredContent(fn ($json) => $json
            ->where('data.title', 'Fix login')
            ->where('data.status', 'in_progress')
            ->etc());

    $task = Task::query()->sole();
    expect($task->created_by)->toBe($this->member->id)
        ->and($task->number)->toBe(1)
        ->and($task->description)->toBe('Details');
    Event::assertDispatched(TaskCreated::class);
});

it('notifies the assignee', function () {
    Event::fake([TaskAssigned::class]);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'title' => 'Fix login',
        'assignee_id' => $this->ana->id,
    ])->assertOk();

    expect(Task::query()->sole()->assignee_id)->toBe($this->ana->id)
        ->and(AppNotification::query()->where('user_id', $this->ana->id)->where('type', NotificationType::TaskAssigned->value)->count())->toBe(1);
    Event::assertDispatched(TaskAssigned::class);
});

it('rejects an assignee without access to the project', function () {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'title' => 'Fix login',
        'assignee_id' => $this->outsider->id,
    ])->assertHasErrors();

    expect(Task::query()->count())->toBe(0);
});

it('rejects a project the user cannot see', function () {
    ($this->call)($this->outsider, [
        'project_id' => $this->project->id,
        'title' => 'Fix login',
    ])->assertHasErrors();

    expect(Task::query()->count())->toBe(0);
});

it('rejects an archived project', function () {
    $this->project->forceFill(['archived_at' => now()])->save();

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'title' => 'Fix login',
    ])->assertHasErrors();

    expect(Task::query()->count())->toBe(0);
});

it('rejects an empty or whitespace-only title', function (string $title) {
    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'title' => $title,
    ])->assertHasErrors();

    expect(Task::query()->count())->toBe(0);
})->with(['', "  \n\t "]);

it('links a log group of the project once', function () {
    $group = LogGroup::factory()->for($this->project)->create();

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'title' => 'From alert',
        'log_group_id' => $group->id,
    ])->assertOk();

    expect(Task::query()->sole()->log_group_id)->toBe($group->id);

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'title' => 'Again',
        'log_group_id' => $group->id,
    ])->assertHasErrors();

    expect(Task::query()->count())->toBe(1);
});

it('rejects a log group of another project', function () {
    $other = Project::factory()->for($this->organization)->create();
    $group = LogGroup::factory()->for($other)->create();

    ($this->call)($this->member, [
        'project_id' => $this->project->id,
        'title' => 'From alert',
        'log_group_id' => $group->id,
    ])->assertHasErrors();

    expect(Task::query()->count())->toBe(0);
});
