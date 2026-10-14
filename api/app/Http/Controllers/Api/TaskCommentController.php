<?php

namespace App\Http\Controllers\Api;

use App\Enums\NotificationType;
use App\Events\TaskCommentCreated;
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
use App\Models\TaskCommentMention;
use App\Models\User;
use App\Support\MentionTargets;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Throwable;

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
            $this->syncMentions($comment, $task, $request->user()->id, []);
            $this->linkAttachments($comment, $request->attachmentIds(), $request->user()->id);
        });
        $comment->load(self::RELATIONS);
        TaskCommentCreated::dispatch($comment, $project->id);

        return (new TaskCommentResource($comment))->response()->setStatusCode(201);
    }

    public function update(UpdateTaskCommentRequest $request, Project $project, Task $task, TaskComment $comment): TaskCommentResource
    {
        $body = $request->validated('body');
        $removeIds = $request->removeAttachmentIds();
        $edited = false;
        $addedMentionIds = [];

        DB::transaction(function () use ($request, $task, &$comment, $body, $removeIds, &$edited, &$addedMentionIds) {
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

            $addedMentionIds = $this->syncMentions($comment, $task, $request->user()->id);
        });

        $comment->load(self::RELATIONS);

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

    /**
     * Only syncs the mention rows; notifications are sent by the NotifyTaskCommentRecipients listener. `$currentIds` skips the lookup (new comment: []).
     *
     * A removed mention also drops its notification, as the chat does. Returns the ids of the newly mentioned users.
     *
     * @param  list<int>|null  $currentIds
     * @return list<int>
     */
    private function syncMentions(TaskComment $comment, Task $task, int $authorId, ?array $currentIds = null): array
    {
        $targets = MentionTargets::resolve(
            $comment->body,
            $authorId,
            $comment->organization_id,
            $task->project_id,
            config('chat.mentions.max_per_message'),
        );

        $currentIds ??= TaskCommentMention::query()
            ->where('task_comment_id', $comment->id)
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $removed = array_values(array_diff($currentIds, $targets->pluck('id')->all()));
        $added = $targets->reject(fn (User $user) => in_array($user->id, $currentIds, true));

        if ($removed !== []) {
            TaskCommentMention::query()
                ->where('task_comment_id', $comment->id)
                ->whereIn('user_id', $removed)
                ->delete();
            AppNotification::query()
                ->withoutGlobalScopes()
                ->where('organization_id', $comment->organization_id)
                ->where('type', NotificationType::TaskCommentMention->value)
                ->where('subject_type', TaskComment::class)
                ->where('subject_id', $comment->id)
                ->whereIn('user_id', $removed)
                ->delete();
        }

        if ($added->isEmpty()) {
            return [];
        }

        $now = now();
        TaskCommentMention::query()->insert($added->map(fn (User $user) => [
            'organization_id' => $comment->organization_id,
            'task_comment_id' => $comment->id,
            'user_id' => $user->id,
            'created_at' => $now,
        ])->values()->all());

        return $added->pluck('id')->map(fn ($id) => (int) $id)->values()->all();
    }
}
