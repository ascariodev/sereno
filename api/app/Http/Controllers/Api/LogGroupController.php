<?php

namespace App\Http\Controllers\Api;

use App\Actions\ListLogGroups;
use App\Actions\LoadLogGroupDetail;
use App\Actions\PostLogGroupStatusNotice;
use App\Actions\PostTaskGroupReopenedNotice;
use App\Enums\LogGroupStatus;
use App\Enums\TaskStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\LogGroup\HourlyLogGroupsRequest;
use App\Http\Requests\LogGroup\ListLogGroupsRequest;
use App\Http\Requests\LogGroup\UpdateLogGroupRequest;
use App\Http\Resources\LogGroupHourlyResource;
use App\Http\Resources\LogGroupResource;
use App\Models\LogGroup;
use App\Models\Project;
use App\Models\Task;
use App\Support\LogGroupHourlyCounts;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class LogGroupController extends Controller
{
    public function index(ListLogGroupsRequest $request, Project $project, ListLogGroups $list): AnonymousResourceCollection
    {
        $groups = $list($project, $request->status(), $request->minimumLevel(), $request->perPage())->withQueryString();

        return LogGroupResource::collection($groups);
    }

    public function hourly(HourlyLogGroupsRequest $request, Project $project): LogGroupHourlyResource
    {
        $hourly = LogGroupHourlyCounts::for($project, $request->ids(), now());
        $hourly['tasks'] = $this->tasksOfGroups($project, array_keys($hourly['counts']));

        return new LogGroupHourlyResource($hourly);
    }

    public function show(Project $project, LogGroup $group, LoadLogGroupDetail $loadDetail): LogGroupResource
    {
        throw_unless($group->project_id === $project->id, ModelNotFoundException::class);
        Gate::authorize('view', $group);

        return new LogGroupResource($loadDetail($project, $group));
    }

    public function update(UpdateLogGroupRequest $request, Project $project, LogGroup $group, PostLogGroupStatusNotice $postNotice, PostTaskGroupReopenedNotice $postReopened): LogGroupResource
    {
        $updated = DB::transaction(function () use ($group, $request, $postNotice, $postReopened) {
            // Lock to read the real previous status: ingestion can change it in parallel.
            $locked = LogGroup::query()->whereKey($group->id)->lock('for no key update')->firstOrFail();
            $previousStatus = $locked->status;
            $locked->status = $request->validated('status');

            if ($locked->isDirty('status')) {
                $locked->save();
                $postNotice($locked, $previousStatus, $request->user());

                if ($previousStatus === LogGroupStatus::Resolved && $locked->status === LogGroupStatus::Open) {
                    $postReopened($locked->organization_id, $locked->project_id, $locked->id);
                }
            }

            return $locked;
        });

        $this->bindTaskProject(collect([$updated->load('task')]), $project);

        return new LogGroupResource($updated);
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
}
