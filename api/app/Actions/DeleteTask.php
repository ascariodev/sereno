<?php

namespace App\Actions;

use App\Models\Task;
use App\Models\TaskCommentAttachment;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Deletes the task (comments and attachment rows go by cascade) and, after the commit, the comment attachment files
 * and the task directory. On a rollback nothing leaves the disk; a file missed here is swept by
 * `chat:prune-attachments` once it has no row.
 */
class DeleteTask
{
    public function __invoke(Task $task): void
    {
        DB::transaction(function () use ($task) {
            // FOR UPDATE waits for uploads in flight (their FK holds a key-share lock on the task), so their rows are
            // read below; a later upload fails its FK and removes its own file.
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
