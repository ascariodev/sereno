<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\LogSource\StoreLogSourceRequest;
use App\Http\Resources\LogSourceResource;
use App\Models\LogSource;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class LogSourceController extends Controller
{
    public function index(Project $project): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', LogSource::class);

        return LogSourceResource::collection(
            $project->logSources()->orderBy('created_at')->orderBy('id')->get(),
        );
    }

    public function store(StoreLogSourceRequest $request, Project $project): JsonResponse
    {
        [$source, $plainKey] = LogSource::issueFor($project, $request->validated('name'));

        return response()->json([
            'data' => [...(new LogSourceResource($source))->resolve(), 'key' => $plainKey],
        ], 201);
    }

    public function destroy(Project $project, LogSource $source): LogSourceResource
    {
        abort_unless($source->project_id === $project->id, 404);
        Gate::authorize('revoke', $source);

        if (! $source->isRevoked()) {
            $source->forceFill(['revoked_at' => now()])->save();
        }

        return new LogSourceResource($source);
    }
}
