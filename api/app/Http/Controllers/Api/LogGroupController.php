<?php

namespace App\Http\Controllers\Api;

use App\Actions\PostLogGroupStatusNotice;
use App\Enums\LogLevel;
use App\Enums\TaskStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\LogGroup\HourlyLogGroupsRequest;
use App\Http\Requests\LogGroup\ListLogGroupsRequest;
use App\Http\Requests\LogGroup\UpdateLogGroupRequest;
use App\Http\Resources\LogGroupHourlyResource;
use App\Http\Resources\LogGroupResource;
use App\Models\LogEvent;
use App\Models\LogGroup;
use App\Models\Project;
use App\Models\Task;
use App\Support\LogGroupHourlyCounts;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class LogGroupController extends Controller
{
    public const DETAIL_EVENTS_LIMIT = 50;

    public function index(ListLogGroupsRequest $request, Project $project): AnonymousResourceCollection
    {
        $minimumLevel = $request->minimumLevel();

        $groups = LogGroup::query()
            ->where('project_id', $project->id)
            ->when($request->status(), fn ($query, $status) => $query->where('status', $status))
            ->when($minimumLevel, fn ($query) => $query->whereIn('level', $this->levelsAtLeast($minimumLevel)))
            ->orderByDesc('last_seen_at')
            ->orderByDesc('id')
            ->with('task')
            ->paginate($request->perPage())
            ->withQueryString();

        $this->bindTaskProject($groups->getCollection(), $project);

        return LogGroupResource::collection($groups);
    }

    public function hourly(HourlyLogGroupsRequest $request, Project $project): LogGroupHourlyResource
    {
        $hourly = LogGroupHourlyCounts::for($project, $request->ids(), now());
        $hourly['tasks'] = $this->tasksOfGroups($project, array_keys($hourly['counts']));

        return new LogGroupHourlyResource($hourly);
    }

    public function show(Project $project, LogGroup $group): LogGroupResource
    {
        abort_unless($group->project_id === $project->id, 404);
        Gate::authorize('view', $group);

        $group->setRelation('events', LogEvent::query()
            ->with('source:id,name')
            ->where('log_group_id', $group->id)
            ->where('received_at', '>=', now()->subDays(config('workspace.log.retention_days')))
            ->orderByDesc('received_at')
            ->orderByDesc('id')
            ->limit(self::DETAIL_EVENTS_LIMIT)
            ->get());

        $this->bindTaskProject(collect([$group->load('task')]), $project);

        return new LogGroupResource($group);
    }

    public function update(UpdateLogGroupRequest $request, Project $project, LogGroup $group, PostLogGroupStatusNotice $postNotice): LogGroupResource
    {
        abort_unless($group->project_id === $project->id, 404);

        $previousStatus = $group->status;
        $group->status = $request->validated('status');

        if ($group->isDirty('status')) {
            DB::transaction(function () use ($group, $previousStatus, $request, $postNotice) {
                $group->save();
                $postNotice($group, $previousStatus, $request->user());
            });
        }

        $this->bindTaskProject(collect([$group->load('task')]), $project);

        return new LogGroupResource($group);
    }

    /**
     * @param  list<int>  $groupIds
     * @return array<int, array{id: int, key: string, status: TaskStatus}>
     */
    private function tasksOfGroups(Project $project, array $groupIds): array
    {
        if ($groupIds === []) {
            return [];
        }

        $tasks = [];
        foreach (Task::query()->where('project_id', $project->id)->whereIn('log_group_id', $groupIds)->get() as $task) {
            $task->setRelation('project', $project);
            $tasks[$task->log_group_id] = ['id' => $task->id, 'key' => $task->key(), 'status' => $task->status];
        }

        return $tasks;
    }

    /** @param  Collection<int, LogGroup>  $groups */
    private function bindTaskProject(Collection $groups, Project $project): void
    {
        foreach ($groups as $group) {
            $group->task?->setRelation('project', $project);
        }
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
