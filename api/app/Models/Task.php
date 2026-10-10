<?php

namespace App\Models;

use App\Enums\TaskStatus;
use App\Models\Concerns\BelongsToOrganization;
use App\Models\Concerns\EnsuresProjectInOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['title', 'description', 'status', 'position'])]
class Task extends Model
{
    use BelongsToOrganization, EnsuresProjectInOrganization;

    public const TITLE_MAX_LENGTH = 200;

    protected function casts(): array
    {
        return [
            'status' => TaskStatus::class,
            'number' => 'integer',
            'position' => 'float',
        ];
    }

    public function key(): string
    {
        return $this->project->key.'-'.$this->number;
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function logGroup(): BelongsTo
    {
        return $this->belongsTo(LogGroup::class);
    }
}
