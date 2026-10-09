<?php

namespace App\Console\Commands;

use App\Models\MessageAttachment;
use App\Models\Scopes\OrganizationScope;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Throwable;

#[Signature('chat:prune-attachments')]
#[Description('Delete attachments never linked to a message and stray files without a row, past the orphan period')]
class PruneOrphanAttachments extends Command
{
    public const BATCH_SIZE = 200;

    public const MIN_ORPHAN_HOURS = 1;

    public function handle(): int
    {
        $hours = config('chat.attachments.orphan_hours');

        if (! is_int($hours) || $hours < self::MIN_ORPHAN_HOURS) {
            $this->components->error(sprintf(
                'Nothing deleted: the orphan period must be at least %d hour.',
                self::MIN_ORPHAN_HOURS,
            ));

            return self::FAILURE;
        }

        $cutoff = now()->subHours($hours);

        $rows = $this->pruneRows($cutoff);
        $files = $this->pruneStrayFiles($cutoff);

        $this->components->info("Deleted {$rows} orphan attachments and {$files} stray files.");

        return self::SUCCESS;
    }

    private function pruneRows(Carbon $cutoff): int
    {
        $deleted = 0;
        $lastId = 0;

        // Across organizations on purpose: there is no active tenant in a scheduled command.
        $orphans = fn () => MessageAttachment::withoutGlobalScope(OrganizationScope::class)
            ->whereNull('message_id')
            ->where('created_at', '<', $cutoff);

        do {
            $batch = $orphans()
                ->where('id', '>', $lastId)
                ->orderBy('id')
                ->limit(self::BATCH_SIZE)
                ->get(['id', 'disk', 'path']);

            foreach ($batch as $attachment) {
                $lastId = $attachment->id;

                // The delete asks again for no message: a row linked meanwhile is kept, file included.
                $removed = $orphans()->whereKey($attachment->id)->delete();

                if ($removed === 1) {
                    $this->deleteFile($attachment->disk, $attachment->path);
                    $deleted++;
                }
            }
        } while ($batch->count() === self::BATCH_SIZE);

        return $deleted;
    }

    /**
     * Files left by a process that died between writing and saving the row. Only old ones are considered, so an
     * upload in flight is never touched, and never one that has a row.
     */
    private function pruneStrayFiles(Carbon $cutoff): int
    {
        $disk = config('chat.attachments.disk');
        $storage = Storage::disk($disk);
        $deleted = 0;

        foreach (array_chunk($storage->allFiles('chat'), self::BATCH_SIZE) as $paths) {
            $known = MessageAttachment::withoutGlobalScope(OrganizationScope::class)
                ->where('disk', $disk)
                ->whereIn('path', $paths)
                ->pluck('path')
                ->all();

            foreach (array_diff($paths, $known) as $path) {
                try {
                    if ($storage->lastModified($path) >= $cutoff->getTimestamp()) {
                        continue;
                    }
                } catch (Throwable) {
                    continue;
                }

                $this->deleteFile($disk, $path);
                $deleted++;
            }
        }

        return $deleted;
    }

    private function deleteFile(string $disk, string $path): void
    {
        try {
            Storage::disk($disk)->delete($path);
        } catch (Throwable $e) {
            report($e);
        }
    }
}
