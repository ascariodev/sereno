<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
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
