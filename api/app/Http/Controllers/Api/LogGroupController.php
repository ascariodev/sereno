<?php

namespace App\Http\Controllers\Api;

use App\Enums\LogLevel;
use App\Http\Controllers\Controller;
use App\Http\Requests\LogGroup\ListLogGroupsRequest;
use App\Http\Requests\LogGroup\UpdateLogGroupRequest;
use App\Http\Resources\LogGroupResource;
use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\Project;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class LogGroupController extends Controller
{
    public const DETAIL_EVENTS_LIMIT = 50;

    public function index(ListLogGroupsRequest $request, Project $project): AnonymousResourceCollection
    {
        $minimumLevel = $request->minimumLevel();

        return LogGroupResource::collection(
            LogGroup::query()
                ->where('project_id', $project->id)
                ->when($request->status(), fn ($query, $status) => $query->where('status', $status))
                ->when($minimumLevel, fn ($query) => $query->whereIn('level', $this->levelsAtLeast($minimumLevel)))
                ->orderByDesc('last_seen_at')
                ->orderByDesc('id')
                ->paginate($request->perPage())
                ->withQueryString(),
        );
    }

    public function show(Project $project, LogGroup $group): LogGroupResource
    {
        abort_unless($group->project_id === $project->id, 404);
        Gate::authorize('view', $group);

        $group->setRelation('events', LogEvent::query()
            ->where('log_group_id', $group->id)
            ->where('received_at', '>=', now()->subDays(config('workspace.log.retention_days')))
            ->orderByDesc('received_at')
            ->orderByDesc('id')
            ->limit(self::DETAIL_EVENTS_LIMIT)
            ->get());

        return new LogGroupResource($group);
    }

    public function update(UpdateLogGroupRequest $request, Project $project, LogGroup $group): LogGroupResource
    {
        abort_unless($group->project_id === $project->id, 404);

        $group->update(['status' => $request->validated('status')]);

        return new LogGroupResource($group);
    }

    /** @return list<string> */
    private function levelsAtLeast(LogLevel $minimum): array
    {
        return array_values(array_map(
            fn (LogLevel $level) => $level->value,
            array_filter(LogLevel::cases(), fn (LogLevel $level) => $level->isAtLeast($minimum)),
        ));
    }
}
