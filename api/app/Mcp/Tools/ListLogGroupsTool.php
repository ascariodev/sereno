<?php

namespace App\Mcp\Tools;

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Http\Requests\LogGroup\ListLogGroupsRequest;
use App\Http\Resources\LogGroupResource;
use App\Models\LogGroup;
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

#[Description('Lists the log alert groups of a project, most recently seen first. Filter by status and by minimum level. Use get-log-group for the recent events of one group.')]
#[Name('list-log-groups')]
#[IsReadOnly]
#[IsIdempotent]
class ListLogGroupsTool extends Tool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->integer()
                ->description('Id of the project, as returned by list-projects.')
                ->required(),
            'status' => $schema->string()
                ->enum(array_column(LogGroupStatus::cases(), 'value'))
                ->description('Only groups with this status.'),
            'level' => $schema->string()
                ->enum(array_column(LogLevel::cases(), 'value'))
                ->description('Only groups at this level or more severe.'),
            'per_page' => $schema->integer()
                ->description('Groups per page. Defaults to '.ListLogGroupsRequest::DEFAULT_PER_PAGE.'; at most '.ListLogGroupsRequest::MAX_PER_PAGE.'.'),
            'page' => $schema->integer()
                ->description('Page number, starting at 1. Use meta.has_more to know if there is a next page.'),
        ];
    }

    protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory
    {
        $ids = $request->validate([
            'project_id' => ['required', 'integer', 'min:1'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $project = Project::query()->findOrFail($ids['project_id']);
        $this->authorize($user, 'view', $project);
        $this->authorize($user, 'viewAny', LogGroup::class);

        $filters = $request->validate((new ListLogGroupsRequest)->rules());
        $status = LogGroupStatus::tryFrom((string) ($filters['status'] ?? ''));
        $minimumLevel = LogLevel::tryFrom((string) ($filters['level'] ?? ''));
        $levels = $minimumLevel === null ? null : array_values(array_map(
            fn (LogLevel $level) => $level->value,
            array_filter(LogLevel::cases(), fn (LogLevel $level) => $level->isAtLeast($minimumLevel)),
        ));

        $groups = LogGroup::query()
            ->where('project_id', $project->id)
            ->when($status, fn ($query) => $query->where('status', $status))
            ->when($levels, fn ($query) => $query->whereIn('level', $levels))
            ->orderByDesc('last_seen_at')
            ->orderByDesc('id')
            ->with('task')
            ->paginate((int) ($filters['per_page'] ?? ListLogGroupsRequest::DEFAULT_PER_PAGE), page: $ids['page'] ?? 1);

        foreach ($groups as $group) {
            $group->task?->setRelation('project', $project);
        }

        return $this->structured([
            'data' => LogGroupResource::collection($groups->getCollection())->resolve(),
            'meta' => [
                'current_page' => $groups->currentPage(),
                'total' => $groups->total(),
                'has_more' => $groups->hasMorePages(),
            ],
        ]);
    }
}
