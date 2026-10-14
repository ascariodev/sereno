<?php

namespace App\Support;

use finfo;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use League\Flysystem\UnableToRetrieveMetadata;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AttachmentStorage
{
    public const MAX_NAME_LENGTH = 255;

    private const MAX_EXTENSION_LENGTH = 16;

    private const FALLBACK_MIME = 'application/octet-stream';

    // Only raster images the browser cannot run as a document are shown inline; svg and the rest are downloaded.
    private const INLINE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    // Types a browser may render or execute are sent as opaque bytes even as a download.
    // pdf too: Firefox opens it in its own viewer despite the attachment disposition.
    private const OPAQUE_MIME_PATTERN = '#^text/|html|xml|javascript|ecmascript|svg|^application/pdf$#i';

    private const MIME_PATTERN = '#^[a-z0-9][a-z0-9!\#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!\#$&^_.+-]{0,126}$#i';

    /**
     * Stores the upload under `$directory` and returns what the attachment row needs. Nothing from the client
     * goes into the path: the caller passes server ids and the file gets a random name without extension.
     *
     * @return array{path: string, original_name: string, mime: string, size: int}
     */
    public static function store(UploadedFile $file, string $disk, string $directory): array
    {
        $path = Storage::disk($disk)->putFileAs($directory, $file, Str::random(40));

        if ($path === false) {
            throw new RuntimeException('Could not store the attachment.');
        }

        return [
            'path' => $path,
            'original_name' => self::originalName($file),
            'mime' => self::mime($file),
            'size' => $file->getSize(),
        ];
    }

    /**
     * Streams a stored file with headers that keep the browser from running it. A missing file is a 404;
     * `$label` names the attachment in the report when the file cannot be opened. The `max-age` comes from the
     * `expires` query parameter, so the route must be signed (temporary signed URL); without it the cache is 0.
     */
    public static function download(Request $request, string $diskName, string $path, string $mime, string $name, string $label): StreamedResponse
    {
        $disk = Storage::disk($diskName);

        try {
            $size = $disk->size($path);
        } catch (UnableToRetrieveMetadata) {
            throw new ModelNotFoundException;
        }

        $inline = in_array($mime, self::INLINE_MIMES, true);
        $maxAge = max(0, (int) $request->query('expires') - now()->getTimestamp());

        // The file is opened only to send a body: never on a HEAD, even if the response is sent without prepare().
        return new StreamedResponse(function () use ($request, $disk, $diskName, $path, $label) {
            if ($request->isMethod('HEAD')) {
                return;
            }

            $stream = $disk->readStream($path);

            if (! is_resource($stream)) {
                report(new RuntimeException("{$label} could not be opened at {$diskName}:{$path}."));

                return;
            }

            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $inline ? $mime : self::downloadMime($mime),
            'Content-Length' => (string) $size,
            'Content-Disposition' => self::disposition($inline ? 'inline' : 'attachment', $name),
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            'Referrer-Policy' => 'no-referrer',
            'Cache-Control' => "private, max-age={$maxAge}",
        ]);
    }

    private static function downloadMime(string $mime): string
    {
        return preg_match(self::MIME_PATTERN, $mime) === 1 && preg_match(self::OPAQUE_MIME_PATTERN, $mime) !== 1
            ? $mime
            : self::FALLBACK_MIME;
    }

    // RFC 6266: a plain ASCII fallback plus the exact name percent-encoded, so quotes, ';' or line breaks
    // in the name can never end the header value.
    private static function disposition(string $type, string $name): string
    {
        $fallback = trim(preg_replace('/[^A-Za-z0-9._ ()-]+/', '_', Str::ascii($name)) ?? '', ' ._');

        return sprintf(
            '%s; filename="%s"; filename*=UTF-8\'\'%s',
            $type,
            $fallback === '' ? 'file' : $fallback,
            rawurlencode($name),
        );
    }

    private static function originalName(UploadedFile $file): string
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

        $base = rtrim(mb_substr($name, 0, self::MAX_NAME_LENGTH - mb_strlen($suffix)), ' .');

        return ($base === '' ? 'file' : $base).$suffix;
    }

    // Detected from the content, never from the Content-Type the client sent.
    private static function mime(UploadedFile $file): string
    {
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file->getRealPath());

        return is_string($mime) && $mime !== '' ? Str::limit($mime, 127, '') : self::FALLBACK_MIME;
    }
}
