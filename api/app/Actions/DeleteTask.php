<?php

namespace App\Actions;

use App\Models\Task;
use App\Models\TaskCommentAttachment;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

/** Files are deleted after the commit; any missed is swept by `chat:prune-attachments`. */
class DeleteTask
{
    public function __invoke(Task $task): void
    {
        DB::transaction(function () use ($task) {
            // Waits for uploads in flight (FK key-share lock) so their rows are read below.
            $locked = Task::query()->whereKey($task->id)->lockForUpdate()->first();
            if ($locked === null) {
                return;
            }

            $files = TaskCommentAttachment::query()->where('task_id', $locked->id)->get(['id', 'disk', 'path']);

            $locked->delete();

            $disk = config('chat.attachments.disk');
            $directory = "tasks/{$locked->organization_id}/{$locked->id}";

            DB::afterCommit(function () use ($files, $disk, $directory) {
                foreach ($files as $file) {
                    try {
                        Storage::disk($file->disk)->delete($file->path);
                    } catch (Throwable $e) {
                        report($e);
                    }
                }

                try {
                    Storage::disk($disk)->deleteDirectory($directory);
                } catch (Throwable $e) {
                    report($e);
                }
            });
        });
    }
}
