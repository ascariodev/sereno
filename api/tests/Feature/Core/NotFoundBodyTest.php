<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\LogSource;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\CurrentOrganization;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create();
    assignMembersToAllProjects();

    $this->hiddenProject = Project::factory()->for($this->organization)->create();
    $this->hiddenChannel = Channel::factory()->for($this->hiddenProject)->create();
    $this->hiddenMessage = Message::withoutEvents(
        fn () => Message::factory()->for($this->hiddenChannel)->for($this->member)->create()
    );
    $this->hiddenGroup = LogGroup::factory()->for($this->hiddenProject)->create();
});

it('answers a resource hidden by a policy with the same 404 body as a missing one, in every locale', function () {
    Sanctum::actingAs($this->member);
    $missing = 999999999;

    $pairs = [
        'project' => ["/api/projects/{$this->hiddenProject->id}", "/api/projects/{$missing}"],
        'messages' => ["/api/channels/{$this->hiddenChannel->id}/messages", "/api/channels/{$missing}/messages"],
        'replies' => [
            "/api/channels/{$this->hiddenChannel->id}/messages/{$this->hiddenMessage->id}/replies",
            "/api/channels/{$this->channel->id}/messages/{$missing}/replies",
        ],
        'log group' => [
            "/api/projects/{$this->hiddenProject->id}/log-groups/{$this->hiddenGroup->id}",
            "/api/projects/{$this->project->id}/log-groups/{$missing}",
        ],
    ];

    foreach (['en', 'es'] as $locale) {
        $headers = ['X-Organization-Id' => (string) $this->organization->id, 'Accept-Language' => $locale];

        foreach ($pairs as $endpoint => [$hidden, $nonexistent]) {
            $hiddenBody = $this->getJson($hidden, $headers)->assertNotFound()->assertHeader('Content-Language', $locale)->json();
            $missingBody = $this->getJson($nonexistent, $headers)->assertNotFound()->json();

            expect($hiddenBody)->toBe($missingBody, "{$endpoint} ({$locale})")
                ->and($hiddenBody)->toBe(['message' => __('Resource not found.', [], $locale)]);
        }
    }
});

it('answers a resource of another channel or project with the same 404 body as a missing one, in every locale', function () {
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);
    assignMembersToAllProjects();
    Sanctum::actingAs($admin);
    $missing = 999999999;

    $hiddenSource = LogSource::factory()->for($this->hiddenProject)->create();
    $channelMessage = "/api/channels/{$this->channel->id}/messages";
    $projectUrl = "/api/projects/{$this->project->id}";

    $pairs = [
        'replies' => [
            'GET', "{$channelMessage}/{$this->hiddenMessage->id}/replies",
            'GET', "{$channelMessage}/{$missing}/replies",
        ],
        'update message' => [
            'PATCH', "{$channelMessage}/{$this->hiddenMessage->id}",
            'PATCH', "{$channelMessage}/{$missing}",
        ],
        'delete message' => [
            'DELETE', "{$channelMessage}/{$this->hiddenMessage->id}",
            'DELETE', "{$channelMessage}/{$missing}",
        ],
        'show log group' => [
            'GET', "{$projectUrl}/log-groups/{$this->hiddenGroup->id}",
            'GET', "{$projectUrl}/log-groups/{$missing}",
        ],
        'update log group' => [
            'PATCH', "{$projectUrl}/log-groups/{$this->hiddenGroup->id}",
            'PATCH', "{$projectUrl}/log-groups/{$missing}",
        ],
        'update log group with an invalid body' => [
            'PATCH', "{$projectUrl}/log-groups/{$this->hiddenGroup->id}",
            'PATCH', "{$projectUrl}/log-groups/{$missing}",
            ['status' => 'not-a-status'],
        ],
        'replies with invalid pagination' => [
            'GET', "{$channelMessage}/{$this->hiddenMessage->id}/replies?per_page=0",
            'GET', "{$channelMessage}/{$missing}/replies?per_page=0",
        ],
        'revoke log source' => [
            'DELETE', "{$projectUrl}/log-sources/{$hiddenSource->id}",
            'DELETE', "{$projectUrl}/log-sources/{$missing}",
        ],
        'rotate log source key' => [
            'POST', "{$projectUrl}/log-sources/{$hiddenSource->id}/rotate-key",
            'POST', "{$projectUrl}/log-sources/{$missing}/rotate-key",
        ],
    ];

    foreach (['en', 'es'] as $locale) {
        $headers = ['X-Organization-Id' => (string) $this->organization->id, 'Accept-Language' => $locale];

        foreach ($pairs as $endpoint => $pair) {
            [$hiddenMethod, $hidden, $missingMethod, $nonexistent] = $pair;
            $payload = $pair[4] ?? ['status' => 'resolved', 'body' => 'x'];
            $hiddenBody = $this->json($hiddenMethod, $hidden, $payload, $headers)
                ->assertNotFound()->assertHeader('Content-Language', $locale)->json();
            $missingBody = $this->json($missingMethod, $nonexistent, $payload, $headers)
                ->assertNotFound()->assertHeader('Content-Language', $locale)->json();

            expect($hiddenBody)->toBe($missingBody, "{$endpoint} ({$locale})")
                ->and($hiddenBody)->toBe(['message' => __('Resource not found.', [], $locale)]);
        }
    }
});

function notFoundBodyTask(Project $project): Task
{
    $task = new Task(['title' => 'Fix it', 'position' => 1.0]);
    $task->project_id = $project->id;
    $task->number = 1;
    $task->save();

    return $task;
}

it('answers a task or comment of another project or task with the same 404 body as a missing one, in every locale', function () {
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);
    assignMembersToAllProjects();
    Sanctum::actingAs($admin);
    $missing = 999999999;

    app(CurrentOrganization::class)->set($this->organization);
    $task = notFoundBodyTask($this->project);
    $hiddenTask = notFoundBodyTask($this->hiddenProject);
    $hiddenComment = TaskComment::factory()->forTask($hiddenTask)->create(['user_id' => $admin->id]);

    $tasksUrl = "/api/projects/{$this->project->id}/tasks";
    $commentsUrl = "{$tasksUrl}/{$task->id}/comments";

    $pairs = [
        'show task' => ['GET', "{$tasksUrl}/{$hiddenTask->id}", "{$tasksUrl}/{$missing}", []],
        'update task' => ['PATCH', "{$tasksUrl}/{$hiddenTask->id}", "{$tasksUrl}/{$missing}", ['title' => 'x']],
        'update task with an invalid body' => ['PATCH', "{$tasksUrl}/{$hiddenTask->id}", "{$tasksUrl}/{$missing}", ['title' => '']],
        'delete task' => ['DELETE', "{$tasksUrl}/{$hiddenTask->id}", "{$tasksUrl}/{$missing}", []],
        'move task' => ['POST', "{$tasksUrl}/{$hiddenTask->id}/move", "{$tasksUrl}/{$missing}/move", ['status' => 'done']],
        'move task with an invalid body' => ['POST', "{$tasksUrl}/{$hiddenTask->id}/move", "{$tasksUrl}/{$missing}/move", ['status' => 'nope']],
        'list comments' => ['GET', "{$tasksUrl}/{$hiddenTask->id}/comments", "{$tasksUrl}/{$missing}/comments", []],
        'list comments with invalid pagination' => [
            'GET', "{$tasksUrl}/{$hiddenTask->id}/comments?per_page=0", "{$tasksUrl}/{$missing}/comments?per_page=0", [],
        ],
        'store comment' => ['POST', "{$tasksUrl}/{$hiddenTask->id}/comments", "{$tasksUrl}/{$missing}/comments", ['body' => 'x']],
        'store comment with an invalid body' => ['POST', "{$tasksUrl}/{$hiddenTask->id}/comments", "{$tasksUrl}/{$missing}/comments", ['body' => '']],
        'store comment attachment with an invalid body' => [
            'POST', "{$tasksUrl}/{$hiddenTask->id}/attachments", "{$tasksUrl}/{$missing}/attachments", [],
        ],
        'update comment' => ['PATCH', "{$commentsUrl}/{$hiddenComment->id}", "{$commentsUrl}/{$missing}", ['body' => 'x']],
        'update comment with an invalid body' => ['PATCH', "{$commentsUrl}/{$hiddenComment->id}", "{$commentsUrl}/{$missing}", ['body' => '']],
        'delete comment' => ['DELETE', "{$commentsUrl}/{$hiddenComment->id}", "{$commentsUrl}/{$missing}", []],
    ];

    foreach (['en', 'es'] as $locale) {
        $headers = ['X-Organization-Id' => (string) $this->organization->id, 'Accept-Language' => $locale];

        foreach ($pairs as $endpoint => [$method, $hidden, $nonexistent, $payload]) {
            $hiddenBody = $this->json($method, $hidden, $payload, $headers)
                ->assertNotFound()->assertHeader('Content-Language', $locale)->json();
            $missingBody = $this->json($method, $nonexistent, $payload, $headers)
                ->assertNotFound()->assertHeader('Content-Language', $locale)->json();

            expect($hiddenBody)->toBe($missingBody, "{$endpoint} ({$locale})")
                ->and($hiddenBody)->toBe(['message' => __('Resource not found.', [], $locale)]);
        }
    }

    expect(Task::withoutGlobalScopes()->whereKey($hiddenTask->id)->exists())->toBeTrue()
        ->and(TaskComment::withoutGlobalScopes()->whereKey($hiddenComment->id)->exists())->toBeTrue();
});
