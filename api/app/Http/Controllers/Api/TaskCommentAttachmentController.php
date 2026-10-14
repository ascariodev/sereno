<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\TaskComment\StoreTaskCommentAttachmentRequest;
use App\Http\Resources\TaskCommentAttachmentResource;
use App\Models\Project;
use App\Models\Scopes\OrganizationScope;
use App\Models\Task;
use App\Models\TaskCommentAttachment;
use App\Support\AttachmentStorage;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class TaskCommentAttachmentController extends Controller
{
    public function store(StoreTaskCommentAttachmentRequest $request, Project $project, Task $task): TaskCommentAttachmentResource
    {
        $disk = config('chat.attachments.disk');
        $stored = AttachmentStorage::store($request->file('file'), $disk, "tasks/{$task->organization_id}/{$task->id}");

        $attachment = new TaskCommentAttachment;
        $attachment->organization_id = $task->organization_id;
        $attachment->task_id = $task->id;
        $attachment->user_id = $request->user()->id;
        $attachment->disk = $disk;
        $attachment->path = $stored['path'];
        $attachment->original_name = $stored['original_name'];
        $attachment->mime = $stored['mime'];
        $attachment->size = $stored['size'];

        try {
            $attachment->save();
        } catch (Throwable $e) {
            Storage::disk($disk)->delete($stored['path']);

            throw $e;
        }

        return new TaskCommentAttachmentResource($attachment);
    }

    /**
     * A fresh signed url for an attachment linked to a comment, only for who can still see its task.
     * Every failure is a 404 so the response does not reveal whether the attachment exists.
     */
    public function url(TaskCommentAttachment $attachment): JsonResponse
    {
        if ($attachment->task_comment_id === null || Gate::denies('view', $attachment->task)) {
            throw new ModelNotFoundException;
        }

        $signed = $attachment->signedDownload();

        return response()->json(['data' => [
            'url' => $signed['url'],
            'expires_at' => $signed['expires_at']->toIso8601String(),
        ]]);
    }

    /**
     * Public route authorized only by the signed URL, like the chat download: the tenant is not active here and
     * the lookup skips its scope on purpose. The signature covers the id, so a url cannot reach another row.
     */
    public function download(Request $request, int $attachment): StreamedResponse
    {
        $attachment = TaskCommentAttachment::withoutGlobalScope(OrganizationScope::class)
            ->whereKey($attachment)
            ->whereNotNull('task_comment_id')
            ->first();

        throw_if($attachment === null, ModelNotFoundException::class);

        return AttachmentStorage::download(
            $request,
            $attachment->disk,
            $attachment->path,
            $attachment->mime,
            $attachment->original_name,
            "Task comment attachment {$attachment->id}",
        );
    }
}
