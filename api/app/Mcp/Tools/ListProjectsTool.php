<?php

namespace App\Mcp\Tools;

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Http\Resources\ProjectResource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\ProjectAccess;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('Lists the projects of the organization that the current user can see, with their id, key and number of open log alerts. Archived projects are hidden unless include_archived is true.')]
#[Name('list-projects')]
#[IsReadOnly]
#[IsIdempotent]
class ListProjectsTool extends Tool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'include_archived' => $schema->boolean()
                ->description('Also return archived projects. Defaults to false.'),
        ];
    }

    protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory
    {
        $request->validate(['include_archived' => ['nullable', 'boolean']]);

        $this->authorize($user, 'viewAny', Project::class);

        $open = fn (Builder $query) => $query->where('status', LogGroupStatus::Open->value);

        $projects = ProjectAccess::restrict(Project::query(), $user, $organization->id)
            ->when(! $request->boolean('include_archived'), fn ($query) => $query->whereNull('archived_at'))
            ->withCount(['logGroups as open_groups_count' => $open])
            ->withAggregate(['logGroups as open_max_severity' => $open], DB::raw(LogLevel::severitySql('level')), 'max')
            ->orderBy('name')
            ->orderBy('id')
            ->get();

        return $this->structured(['data' => ProjectResource::collection($projects)->resolve()]);
    }
}
