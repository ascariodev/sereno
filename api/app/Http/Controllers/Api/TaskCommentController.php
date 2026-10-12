<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\TaskComment\ListTaskCommentsRequest;
use App\Http\Requests\TaskComment\StoreTaskCommentRequest;
use App\Http\Resources\TaskCommentResource;
use App\Models\Project;
use App\Models\Task;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class TaskCommentController extends Controller
{
    public const RELATIONS = ['user:id,name'];

    public function index(ListTaskCommentsRequest $request, Project $project, Task $task): AnonymousResourceCollection
    {
        $page = $task->comments()
            ->with(self::RELATIONS)
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return TaskCommentResource::collection($page);
    }

    public function store(StoreTaskCommentRequest $request, Project $project, Task $task): JsonResponse
    {
        $comment = $task->comments()->make(['body' => $request->validated('body')]);
        $comment->user_id = $request->user()->id;
        $comment->save();
        $comment->load(self::RELATIONS);

        return (new TaskCommentResource($comment))->response()->setStatusCode(201);
    }
}
