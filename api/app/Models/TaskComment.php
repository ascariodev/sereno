<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use Database\Factories\TaskCommentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['body'])]
class TaskComment extends Model
{
    /** @use HasFactory<TaskCommentFactory> */
    use BelongsToOrganization, HasFactory;

    public const BODY_MAX_LENGTH = 10000;

    protected function casts(): array
    {
        return [
            'edited_at' => 'datetime',
        ];
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(TaskCommentAttachment::class, 'task_comment_id');
    }

    public function mentionedUsers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'task_comment_mentions')->select(['users.id', 'users.name']);
    }
}
