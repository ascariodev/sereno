<?php

namespace App\Http\Controllers\Api;

use App\Actions\CreateTaskComment;
use App\Actions\SyncTaskCommentMentions;
use App\Events\TaskCommentDeleted;
use App\Events\TaskCommentUpdated;
use App\Http\Controllers\Controller;
use App\Http\Requests\TaskComment\DeleteTaskCommentRequest;
use App\Http\Requests\TaskComment\ListTaskCommentsRequest;
use App\Http\Requests\TaskComment\StoreTaskCommentRequest;
use App\Http\Requests\TaskComment\UpdateTaskCommentRequest;
use App\Http\Resources\TaskCommentResource;
use App\Models\AppNotification;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\TaskCommentAttachment;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

class TaskCommentController extends Controller
{
    public function index(ListTaskCommentsRequest $request, Project $project, Task $task): AnonymousResourceCollection
    {
        $page = $task->comments()
            ->with(TaskComment::RELATIONS)
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return TaskCommentResource::collection($page);
    }

    public function store(StoreTaskCommentRequest $request, Project $project, Task $task, CreateTaskComment $createTaskComment): JsonResponse
    {
        $comment = $createTaskComment($task, $request->user(), $request->validated('body'), $request->attachmentIds());

        return (new TaskCommentResource($comment))->response()->setStatusCode(201);
    }

    public function update(UpdateTaskCommentRequest $request, Project $project, Task $task, TaskComment $comment, SyncTaskCommentMentions $syncMentions): TaskCommentResource
    {
        $body = $request->validated('body');
        $removeIds = $request->removeAttachmentIds();
        $edited = false;
        $addedMentionIds = [];

        DB::transaction(function () use ($request, $task, &$comment, $body, $removeIds, &$edited, &$addedMentionIds, $syncMentions) {
            // Reread after the lock: a delete or another edit committed while waiting must not be overwritten.
            $locked = TaskComment::query()->whereKey($comment->id)->lockForUpdate()->first();
            throw_if($locked === null, ModelNotFoundException::class);
            $comment = $locked;

            $removed = $this->removeAttachments($comment, $removeIds);

            if ($comment->body !== $body || $removed) {
                $edited = true;
                $comment->body = $body;
                $comment->edited_at = now()->startOfSecond();
                $comment->save();
            }

            $addedMentionIds = $syncMentions($comment, $task, $request->user()->id);
        });

        $comment->load(TaskComment::RELATIONS);

        if ($edited || $addedMentionIds !== []) {
            TaskCommentUpdated::dispatch($comment, $project->id, $addedMentionIds);
        }

        return new TaskCommentResource($comment);
    }

    public function destroy(DeleteTaskCommentRequest $request, Project $project, Task $task, TaskComment $comment): Response
    {
        DB::transaction(function () use ($comment) {
            // The route binding already resolved $comment; re-reading under the lock detects a delete that committed meanwhile (404).
            $locked = TaskComment::query()->whereKey($comment->id)->lockForUpdate()->first();
            throw_if($locked === null, ModelNotFoundException::class);

            $files = TaskCommentAttachment::query()
                ->where('task_comment_id', $locked->id)
                ->get(['disk', 'path']);

            $locked->delete();
            AppNotification::forgetSubjects(TaskComment::class, [$locked->id]);
            $this->deleteFilesAfterCommit($files);
        });

        TaskCommentDeleted::dispatch($comment->organization_id, $project->id, $task->id, $comment->id);

        return response()->noContent();
    }

    /**
     * Deletes the rows now and the files only once the transaction commits, so a rollback keeps both.
     *
     * @param  list<int>  $ids
     */
    private function removeAttachments(TaskComment $comment, array $ids): bool
    {
        if ($ids === []) {
            return false;
        }

        $files = TaskCommentAttachment::query()
            ->where('task_comment_id', $comment->id)
            ->whereIn('id', $ids)
            ->get(['id', 'disk', 'path']);

        if ($files->isEmpty()) {
            return false;
        }

        TaskCommentAttachment::query()->whereIn('id', $files->pluck('id'))->delete();

        $this->deleteFilesAfterCommit($files);

        return true;
    }

    /** @param  Collection<int, TaskCommentAttachment>  $files */
    private function deleteFilesAfterCommit(Collection $files): void
    {
        DB::afterCommit(function () use ($files) {
            foreach ($files as $file) {
                try {
                    Storage::disk($file->disk)->delete($file->path);
                } catch (Throwable $e) {
                    report($e);
                }
            }
        });
    }
}
