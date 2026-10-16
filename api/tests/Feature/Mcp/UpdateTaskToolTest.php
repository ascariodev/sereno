<?php

use App\Enums\NotificationType;
use App\Enums\Role;
use App\Events\TaskAssigned;
use App\Events\TaskUpdated;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\UpdateTaskTool;
use App\Models\AppNotification;
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

    app(CurrentOrganization::class)->set($this->organization);
    $this->task = new Task(['title' => 'Old', 'description' => 'Old desc', 'status' => 'todo', 'position' => 1.0]);
    $this->task->project_id = $this->project->id;
    $this->task->number = 1;
    $this->task->save();

    $this->call = function (User $user, array $arguments) {
        app(CurrentOrganization::class)->set($this->organization);

        return SerenoServer::actingAs($user)->tool(UpdateTaskTool::class, $arguments);
    };
    $this->args = fn (array $extra) => ['project_id' => $this->project->id, 'task_id' => $this->task->id] + $extra;
});

it('updates title and description and emits the event', function () {
    Event::fake([TaskUpdated::class]);

    ($this->call)($this->member, ($this->args)(['title' => '  New  ', 'description' => 'New desc']))
        ->assertOk()
        ->assertStructuredContent(fn ($json) => $json->where('data.title', 'New')->etc());

    $task = $this->task->fresh();
    expect($task->title)->toBe('New')->and($task->description)->toBe('New desc');
    Event::assertDispatched(TaskUpdated::class);
});

it('leaves absent fields untouched', function () {
    ($this->call)($this->member, ($this->args)(['title' => 'New']))->assertOk();

    expect($this->task->fresh()->description)->toBe('Old desc');
});

it('assigns, notifies the new assignee and then unassigns', function () {
    Event::fake([TaskAssigned::class]);

    ($this->call)($this->member, ($this->args)(['assignee_id' => $this->ana->id]))->assertOk();

    expect($this->task->fresh()->assignee_id)->toBe($this->ana->id)
        ->and(AppNotification::query()->where('user_id', $this->ana->id)->where('type', NotificationType::TaskAssigned->value)->count())->toBe(1);
    Event::assertDispatched(TaskAssigned::class);

    ($this->call)($this->member, ($this->args)(['assignee_id' => null]))->assertOk();

    expect($this->task->fresh()->assignee_id)->toBeNull();
});

it('rejects an assignee without access to the project', function () {
    ($this->call)($this->member, ($this->args)(['assignee_id' => $this->outsider->id]))->assertHasErrors();

    expect($this->task->fresh()->assignee_id)->toBeNull();
});

it('rejects an empty or whitespace-only title', function (string $title) {
    ($this->call)($this->member, ($this->args)(['title' => $title]))->assertHasErrors();

    expect($this->task->fresh()->title)->toBe('Old');
})->with(['', "  \n\t "]);

it('rejects a project the user cannot see', function () {
    ($this->call)($this->outsider, ($this->args)(['title' => 'New']))->assertHasErrors();

    expect($this->task->fresh()->title)->toBe('Old');
});

it('rejects a task of another project', function () {
    $other = Project::factory()->for($this->organization)->create();
    $other->members()->attach([$this->member->id], ['organization_id' => $this->organization->id]);

    ($this->call)($this->member, ['project_id' => $other->id, 'task_id' => $this->task->id, 'title' => 'New'])->assertHasErrors();

    expect($this->task->fresh()->title)->toBe('Old');
});

it('rejects an archived project', function () {
    $this->project->forceFill(['archived_at' => now()])->save();

    ($this->call)($this->member, ($this->args)(['title' => 'New']))->assertHasErrors();

    expect($this->task->fresh()->title)->toBe('Old');
});
