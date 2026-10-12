<?php

namespace App\Http\Controllers\Api;

use App\Events\TaskCommentCreated;
use App\Http\Controllers\Controller;
use App\Http\Requests\TaskComment\ListTaskCommentsRequest;
use App\Http\Requests\TaskComment\StoreTaskCommentRequest;
use App\Http\Resources\TaskCommentResource;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\TaskCommentAttachment;
use App\Models\TaskCommentMention;
use App\Models\User;
use App\Support\MentionTargets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TaskCommentController extends Controller
{
    public const RELATIONS = ['user:id,name', 'mentionedUsers', 'attachments'];

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
        DB::transaction(function () use ($comment, $task, $request) {
            $comment->save();
            $this->saveMentions($comment, $task, $request->user()->id);
            $this->linkAttachments($comment, $request->attachmentIds(), $request->user()->id);
        });
        $comment->load(self::RELATIONS);
        TaskCommentCreated::dispatch($comment, $project->id);

        return (new TaskCommentResource($comment))->response()->setStatusCode(201);
    }

    /**
     * Takes the attachments only if they are still free: another comment sent at the same time may have taken
     * them after validation, and then the whole comment is rolled back.
     *
     * @param  list<int>  $ids
     */
    private function linkAttachments(TaskComment $comment, array $ids, int $authorId): void
    {
        if ($ids === []) {
            return;
        }

        $owned = fn () => TaskCommentAttachment::query()
            ->whereIn('id', $ids)
            ->where('task_id', $comment->task_id)
            ->where('user_id', $authorId);

        $owned()->orderBy('id')->lockForUpdate()->pluck('id');

        $linked = $owned()->whereNull('task_comment_id')->update(['task_comment_id' => $comment->id]);

        if ($linked !== count($ids)) {
            throw ValidationException::withMessages([
                'attachment_ids' => __('The attachments do not exist or are already in use.'),
            ]);
        }
    }

    private function saveMentions(TaskComment $comment, Task $task, int $authorId): void
    {
        $targets = MentionTargets::resolve(
            $comment->body,
            $authorId,
            $comment->organization_id,
            $task->project_id,
            config('chat.mentions.max_per_message'),
        );

        if ($targets->isEmpty()) {
            return;
        }

        $now = now();
        TaskCommentMention::query()->insert($targets->map(fn (User $user) => [
            'organization_id' => $comment->organization_id,
            'task_comment_id' => $comment->id,
            'user_id' => $user->id,
            'created_at' => $now,
        ])->all());
    }
}
