<?php

use App\Enums\Role;
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
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->project = Project::factory()->for($this->organization)->create(['key' => 'POSVE']);
    $this->withTask = LogGroup::factory()->for($this->project)->create(['last_seen_at' => now()]);
    $this->withoutTask = LogGroup::factory()->for($this->project)->create(['last_seen_at' => now()->subHour()]);

    app(CurrentOrganization::class)->set($this->organization);
    $task = new Task(['title' => 'Fix', 'position' => 1.0, 'status' => 'in_review']);
    $task->project_id = $this->project->id;
    $task->number = 12;
    $task->log_group_id = $this->withTask->id;
    $task->save();
    $this->task = $task;

    Sanctum::actingAs($this->member);
});

function groupTaskUrl(Project $project, ?LogGroup $group = null): string
{
    return "/api/projects/{$project->id}/log-groups".($group ? "/{$group->id}" : '');
}

function groupTaskGet(string $url)
{
    return test()->withHeader('X-Organization-Id', (string) test()->organization->id)->getJson($url);
}

it('returns the linked task or null in the list without per-group queries', function () {
    foreach (range(1, 5) as $i) {
        LogGroup::factory()->for($this->project)->create(['last_seen_at' => now()->subDays($i)]);
    }

    DB::flushQueryLog();
    DB::enableQueryLog();
    $response = groupTaskGet(groupTaskUrl($this->project))->assertOk();
    $queries = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect($response->json('data.0.task'))->toBe(['id' => $this->task->id, 'key' => 'POSVE-12', 'status' => 'in_review'])
        ->and($response->json('data.1.task'))->toBeNull()
        ->and($queries)->toBeLessThan(12);

    DB::flushQueryLog();
    DB::enableQueryLog();
    groupTaskGet(groupTaskUrl($this->project))->assertOk();
    $base = count(DB::getQueryLog());
    DB::disableQueryLog();
    LogGroup::factory()->for($this->project)->count(3)->create();
    Task::withoutGlobalScopes()->where('id', $this->task->id)->update(['status' => 'done']);
    DB::flushQueryLog();
    DB::enableQueryLog();
    groupTaskGet(groupTaskUrl($this->project))->assertOk();
    expect(count(DB::getQueryLog()))->toBe($base);
    DB::disableQueryLog();
});

it('returns the task in the detail and in the status update', function () {
    groupTaskGet(groupTaskUrl($this->project, $this->withTask))->assertOk()
        ->assertJsonPath('data.task.key', 'POSVE-12');
    groupTaskGet(groupTaskUrl($this->project, $this->withoutTask))->assertOk()
        ->assertJsonPath('data.task', null);

    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->patchJson(groupTaskUrl($this->project, $this->withTask), ['status' => 'resolved'])
        ->assertOk()
        ->assertJsonPath('data.task.key', 'POSVE-12')
        ->assertJsonPath('data.task.status', 'in_review');
});
