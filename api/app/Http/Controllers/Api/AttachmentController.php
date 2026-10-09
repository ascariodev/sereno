<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\StoreAttachmentRequest;
use App\Http\Resources\MessageAttachmentResource;
use App\Models\Channel;
use App\Models\MessageAttachment;
use finfo;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class AttachmentController extends Controller
{
    public const MAX_NAME_LENGTH = 255;

    private const MAX_EXTENSION_LENGTH = 16;

    private const FALLBACK_MIME = 'application/octet-stream';

    public function store(StoreAttachmentRequest $request, Channel $channel): MessageAttachmentResource
    {
        /** @var UploadedFile $file */
        $file = $request->file('file');
        $disk = config('chat.attachments.disk');

        // Nothing from the client goes into the path: server ids and a random name without extension.
        $path = Storage::disk($disk)->putFileAs(
            "chat/{$channel->organization_id}/{$channel->id}",
            $file,
            Str::random(40),
        );

        if ($path === false) {
            throw new RuntimeException('Could not store the attachment.');
        }

        $attachment = new MessageAttachment;
        $attachment->organization_id = $channel->organization_id;
        $attachment->channel_id = $channel->id;
        $attachment->uploaded_by = $request->user()->id;
        $attachment->disk = $disk;
        $attachment->path = $path;
        $attachment->original_name = $this->originalName($file);
        $attachment->mime = $this->mime($file);
        $attachment->size = $file->getSize();

        try {
            $attachment->save();
        } catch (Throwable $e) {
            Storage::disk($disk)->delete($path);

            throw $e;
        }

        return new MessageAttachmentResource($attachment);
    }

    private function originalName(UploadedFile $file): string
    {
        $name = mb_scrub($file->getClientOriginalName(), 'UTF-8');
        $name = Str::afterLast(str_replace('\\', '/', $name), '/');
        $name = trim(preg_replace('/\p{C}+/u', '', $name) ?? '');

        if ($name === '' || trim($name, '.') === '') {
            return 'file';
        }

        if (mb_strlen($name) <= self::MAX_NAME_LENGTH) {
            return $name;
        }

        $extension = pathinfo($name, PATHINFO_EXTENSION);
        $suffix = $extension !== '' && mb_strlen($extension) <= self::MAX_EXTENSION_LENGTH ? '.'.$extension : '';

        return mb_substr($name, 0, self::MAX_NAME_LENGTH - mb_strlen($suffix)).$suffix;
    }

    // Detected from the content, never from the Content-Type the client sent.
    private function mime(UploadedFile $file): string
    {
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file->getRealPath());

        return is_string($mime) && $mime !== '' ? Str::limit($mime, 127, '') : self::FALLBACK_MIME;
    }
}
