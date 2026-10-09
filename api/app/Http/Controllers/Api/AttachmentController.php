<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Channel\StoreAttachmentRequest;
use App\Http\Resources\MessageAttachmentResource;
use App\Models\Channel;
use App\Models\MessageAttachment;
use App\Models\Scopes\OrganizationScope;
use finfo;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class AttachmentController extends Controller
{
    public const MAX_NAME_LENGTH = 255;

    private const MAX_EXTENSION_LENGTH = 16;

    private const FALLBACK_MIME = 'application/octet-stream';

    // Only raster images the browser cannot run as a document are shown inline; svg and the rest are downloaded.
    private const INLINE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    // Types a browser may render or execute are sent as opaque bytes even as a download.
    private const OPAQUE_MIME_PATTERN = '#^text/|html|xml|javascript|ecmascript|svg#i';

    private const MIME_PATTERN = '#^[a-z0-9][a-z0-9!\#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!\#$&^_.+-]{0,126}$#i';

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

        $stream = Storage::disk($attachment->disk)->readStream($attachment->path);

        abort_if(! is_resource($stream), 404, __('Not Found'));

        $inline = in_array($attachment->mime, self::INLINE_MIMES, true);
        $maxAge = max(0, (int) $request->query('expires') - now()->getTimestamp());

        return new StreamedResponse(function () use ($stream) {
            fpassthru($stream);
            fclose($stream);
        }, 200, [
            'Content-Type' => $inline ? $attachment->mime : $this->downloadMime($attachment->mime),
            'Content-Length' => (string) (fstat($stream)['size'] ?? $attachment->size),
            'Content-Disposition' => $this->disposition($inline ? 'inline' : 'attachment', $attachment->original_name),
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            'Referrer-Policy' => 'no-referrer',
            'Cache-Control' => "private, max-age={$maxAge}",
        ]);
    }

    private function downloadMime(string $mime): string
    {
        return preg_match(self::MIME_PATTERN, $mime) === 1 && preg_match(self::OPAQUE_MIME_PATTERN, $mime) !== 1
            ? $mime
            : self::FALLBACK_MIME;
    }

    // RFC 6266: a plain ASCII fallback plus the exact name percent-encoded, so quotes, ';' or line breaks
    // in the name can never end the header value.
    private function disposition(string $type, string $name): string
    {
        $fallback = trim(preg_replace('/[^A-Za-z0-9._ ()-]+/', '_', Str::ascii($name)) ?? '', ' ._');

        return sprintf(
            '%s; filename="%s"; filename*=UTF-8\'\'%s',
            $type,
            $fallback === '' ? 'file' : $fallback,
            rawurlencode($name),
        );
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
