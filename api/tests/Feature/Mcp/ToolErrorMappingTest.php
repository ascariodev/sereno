<?php

use App\Enums\Role;
use App\Mcp\Servers\SerenoServer;
use App\Mcp\Tools\Tool;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Name;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

#[Name('failing-tool')]
class FailingToolStub extends Tool
{
    public static ?Throwable $failure = null;

    protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory
    {
        throw self::$failure;
    }
}

class FailingServerStub extends SerenoServer
{
    protected array $tools = [FailingToolStub::class];
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->user = User::factory()->create();
    $this->organization->addMember($this->user, [Role::Member]);

    $this->fail = function (Throwable $failure) {
        FailingToolStub::$failure = $failure;
        app(CurrentOrganization::class)->set($this->organization);

        return FailingServerStub::actingAs($this->user)->tool(FailingToolStub::class);
    };
});

it('maps a missing model to not found', function () {
    ($this->fail)((new ModelNotFoundException)->setModel(Project::class, [1]))
        ->assertHasErrors(['Not found.']);
});

it('maps an http not found to not found', function () {
    ($this->fail)(new NotFoundHttpException)->assertHasErrors(['Not found.']);
});

it('maps a denied-as-not-found authorization to not found', function () {
    ($this->fail)((new AuthorizationException)->withStatus(404))
        ->assertHasErrors(['Not found.']);
});

it('maps a plain authorization failure to not allowed', function () {
    ($this->fail)(new AuthorizationException)->assertHasErrors(['You are not allowed to do this.']);
});
