<?php

namespace App\Actions;

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Models\LogGroup;
use App\Models\Project;
use Illuminate\Pagination\LengthAwarePaginator;

class ListLogGroups
{
    /** Most recently seen first, optionally filtered by status and by minimum level. */
    public function __invoke(Project $project, ?LogGroupStatus $status, ?LogLevel $minimumLevel, int $perPage, ?int $page = null): LengthAwarePaginator
    {
        $groups = LogGroup::query()
            ->where('project_id', $project->id)
            ->when($status, fn ($query) => $query->where('status', $status))
            ->when($minimumLevel, fn ($query) => $query->whereIn('level', $this->levelsAtLeast($minimumLevel)))
            ->orderByDesc('last_seen_at')
            ->orderByDesc('id')
            ->with('task')
            ->paginate($perPage, page: $page);

        foreach ($groups as $group) {
            $group->task?->setRelation('project', $project);
        }

        return $groups;
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
