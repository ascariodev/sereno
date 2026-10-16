<?php

namespace App\Mcp\Tools;

use App\Actions\ListProjectViewers;
use App\Http\Resources\MemberResource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('Lists the users with access to a project, with id, name, email and role. These are the users that can be assigned to its tasks.')]
#[Name('list-project-members')]
#[IsReadOnly]
#[IsIdempotent]
class ListProjectMembersTool extends Tool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->integer()
                ->description('Id of the project, as returned by list-projects.')
                ->required(),
        ];
    }

    protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory
    {
        $projectId = $request->validate(['project_id' => ['required', 'integer', 'min:1']])['project_id'];

        $project = Project::query()->findOrFail($projectId);
        $this->authorize($user, 'view', $project);

        $members = MemberResource::collection(app(ListProjectViewers::class)($organization, $project));

        foreach ($members->collection as $member) {
            $member->showEmail();
        }

        return $this->structured(['data' => $members->resolve()]);
    }
}
