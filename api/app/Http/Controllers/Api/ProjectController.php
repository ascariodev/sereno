<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Project\ListProjectsRequest;
use App\Http\Requests\Project\ProjectRequest;
use App\Http\Resources\ProjectResource;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class ProjectController extends Controller
{
    public function index(ListProjectsRequest $request): AnonymousResourceCollection
    {
        return ProjectResource::collection(
            Project::query()
                ->when(! $request->includeArchived(), fn ($query) => $query->whereNull('archived_at'))
                ->orderBy('name')
                ->orderBy('id')
                ->paginate($request->perPage())
                ->withQueryString(),
        );
    }

    public function store(ProjectRequest $request): JsonResponse
    {
        $project = Project::create($request->validated());

        return (new ProjectResource($project))->response()->setStatusCode(201);
    }

    public function show(Project $project): ProjectResource
    {
        Gate::authorize('view', $project);

        return new ProjectResource($project);
    }

    public function update(ProjectRequest $request, Project $project): ProjectResource
    {
        $project->update($request->validated());

        return new ProjectResource($project);
    }

    public function archive(Project $project): ProjectResource
    {
        Gate::authorize('archive', $project);

        $project->forceFill(['archived_at' => $project->archived_at ?? now()])->save();

        return new ProjectResource($project);
    }

    public function unarchive(Project $project): ProjectResource
    {
        Gate::authorize('archive', $project);

        $project->forceFill(['archived_at' => null])->save();

        return new ProjectResource($project);
    }
}
