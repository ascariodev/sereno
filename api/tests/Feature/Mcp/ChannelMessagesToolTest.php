<?php

use App\Enums\Role;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\ListChannelMessagesTool;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Pagination\Cursor;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->member = User::factory()->create(['name' => 'Ana']);
    $this->outsider = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->organization->addMember($this->outsider, [Role::Member]);

    $this->project = Project::factory()->for($this->organization)->create();
    $this->project->members()->attach($this->member->id, ['organization_id' => $this->organization->id]);
    $this->channel = Channel::factory()->for($this->project)->create();

    $this->post = fn (string $body, array $extra = []) => Message::factory()->for($this->channel)->create([
        'kind' => Message::KIND_USER, 'user_id' => $this->member->id, 'body' => $body,
    ] + $extra);

    $this->call = function (User $user, array $arguments) {
        app(CurrentOrganization::class)->set($this->organization);

        return SerenoServer::actingAs($user)->tool(ListChannelMessagesTool::class, $arguments);
    };
});

it('pages the root messages newest first with their reply counts', function () {
    $first = ($this->post)('first message');
    ($this->post)('second message');
    ($this->post)('reply text', ['parent_id' => $first->id]);
    $first->forceFill(['replies_count' => 1])->save();

    ($this->call)($this->member, ['project_id' => $this->project->id, 'per_page' => 1])
        ->assertOk()
        ->assertSee('second message')
        ->assertDontSee('first message')
        ->assertStructuredContent(fn ($json) => $json
            ->has('data', 1)
            ->whereType('next_cursor', 'string')
            ->etc());

    ($this->call)($this->member, ['project_id' => $this->project->id])
        ->assertSee(['first message', 'second message'])
        ->assertDontSee('reply text')
        ->assertStructuredContent(fn ($json) => $json
            ->has('data', 2)
            ->where('data.1.replies_count', 1)
            ->where('next_cursor', null)
            ->etc());
});

it('reads older messages with the cursor', function () {
    ($this->post)('older message');
    $newer = ($this->post)('newer message');

    $encoded = (new Cursor(['id' => $newer->id]))->encode();

    ($this->call)($this->member, ['project_id' => $this->project->id, 'cursor' => $encoded])
        ->assertOk()
        ->assertSee('older message')
        ->assertDontSee('newer message');
});

it('rejects an invalid cursor', function () {
    ($this->call)($this->member, ['project_id' => $this->project->id, 'cursor' => 'garbage'])
        ->assertHasErrors();
});

it('reads a thread with its root in meta', function () {
    $root = ($this->post)('thread root');
    ($this->post)('thread reply', ['parent_id' => $root->id]);
    $root->forceFill(['replies_count' => 1])->save();
    ($this->post)('unrelated root');

    ($this->call)($this->member, ['project_id' => $this->project->id, 'thread_id' => $root->id])
        ->assertOk()
        ->assertSee(['thread reply', 'thread root'])
        ->assertDontSee('unrelated root')
        ->assertStructuredContent(fn ($json) => $json
            ->has('data', 1)
            ->where('data.0.body', 'thread reply')
            ->where('meta.root.id', $root->id)
            ->where('meta.root.replies_count', 1)
            ->has('meta.root.recent_participants', 1)
            ->etc());
});

it('does not find a reply or a message of another channel as a thread', function () {
    $root = ($this->post)('thread root');
    $reply = ($this->post)('thread reply', ['parent_id' => $root->id]);
    $other = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $foreign = Message::factory()->for($other)->create(['kind' => Message::KIND_USER, 'body' => 'foreign']);

    foreach ([$reply->id, $foreign->id] as $id) {
        ($this->call)($this->member, ['project_id' => $this->project->id, 'thread_id' => $id])
            ->assertHasErrors(['Not found.']);
    }
});

it('returns an error for a project the user cannot see', function () {
    ($this->post)('secret');

    ($this->call)($this->outsider, ['project_id' => $this->project->id])
        ->assertHasErrors(['Not found.'])
        ->assertDontSee('secret');
});

it('returns an error for a project of another organization', function () {
    $foreign = Project::factory()->for(Organization::factory()->create())->create();
    Channel::factory()->for($foreign)->create();

    ($this->call)($this->member, ['project_id' => $foreign->id])
        ->assertHasErrors(['Not found.']);
});
