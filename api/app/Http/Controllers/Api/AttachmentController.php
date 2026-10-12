<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\StoreAttachmentRequest;
use App\Http\Resources\MessageAttachmentResource;
use App\Models\Channel;
use App\Models\MessageAttachment;
use App\Models\Scopes\OrganizationScope;
use App\Support\AttachmentStorage;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class AttachmentController extends Controller
{
    public function store(StoreAttachmentRequest $request, Channel $channel): MessageAttachmentResource
    {
        $disk = config('chat.attachments.disk');
        $stored = AttachmentStorage::store($request->file('file'), $disk, "chat/{$channel->organization_id}/{$channel->id}");

        $attachment = new MessageAttachment;
        $attachment->organization_id = $channel->organization_id;
        $attachment->channel_id = $channel->id;
        $attachment->uploaded_by = $request->user()->id;
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

        return new MessageAttachmentResource($attachment);
    }

    /**
     * A fresh signed url for a linked attachment of a live message, only for who can still see its channel.
     * Every failure is a 404 so the response does not reveal whether the attachment exists.
     */
    public function url(MessageAttachment $attachment): JsonResponse
    {
        $message = $attachment->message_id === null ? null : $attachment->message;

        if ($message === null || $message->deleted_at !== null || Gate::denies('view', $attachment->channel)) {
            throw new ModelNotFoundException;
        }

        $signed = $attachment->signedDownload();

        return response()->json(['data' => [
            'url' => $signed['url'],
            'expires_at' => $signed['expires_at']->toIso8601String(),
        ]]);
    }

    /**
     * Public route authorized only by the signed URL (no Bearer nor X-Organization-Id, so it works in <img>):
     * the tenant is not active here and the lookup skips its scope on purpose.
     */
    public function download(Request $request, int $attachment): StreamedResponse
    {
        $attachment = MessageAttachment::withoutGlobalScope(OrganizationScope::class)
            ->whereKey($attachment)
            ->whereNotNull('message_id')
            ->first();

        abort_if($attachment === null, 404, __('Not Found'));

        return AttachmentStorage::download(
            $request,
            $attachment->disk,
            $attachment->path,
            $attachment->mime,
            $attachment->original_name,
            "Attachment {$attachment->id}",
        );
    }
}
