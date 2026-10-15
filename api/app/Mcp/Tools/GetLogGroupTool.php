<?php

namespace App\Mcp\Tools;

use App\Http\Controllers\Api\LogGroupController;
use App\Http\Resources\LogGroupResource;
use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('Returns one log alert group of a project with its most recent events (newest first), including their context, and the linked task if any.')]
#[Name('get-log-group')]
#[IsReadOnly]
#[IsIdempotent]
class GetLogGroupTool extends Tool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->integer()
                ->description('Id of the project, as returned by list-projects.')
                ->required(),
            'group_id' => $schema->integer()
                ->description('Id of the log group, as returned by list-log-groups.')
                ->required(),
        ];
    }

    protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory
    {
        $ids = $request->validate([
            'project_id' => ['required', 'integer', 'min:1'],
            'group_id' => ['required', 'integer', 'min:1'],
        ]);

        $project = Project::query()->findOrFail($ids['project_id']);
        $this->authorize($user, 'view', $project);

        $group = LogGroup::query()->findOrFail($ids['group_id']);
        throw_unless($group->project_id === $project->id, ModelNotFoundException::class);
        $this->authorize($user, 'view', $group);

        $group->setRelation('events', LogEvent::query()
            ->with('source:id,name')
            ->where('log_group_id', $group->id)
            ->where('received_at', '>=', now()->subDays(config('workspace.log.retention_days')))
            ->orderByDesc('received_at')
            ->orderByDesc('id')
            ->limit(LogGroupController::DETAIL_EVENTS_LIMIT)
            ->get());

        $group->load('task')->task?->setRelation('project', $project);

        return $this->structured(['data' => (new LogGroupResource($group))->resolve()]);
    }
}
