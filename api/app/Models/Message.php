<?php

namespace App\Models;

use App\Events\MessageCreated;
use App\Models\Concerns\BelongsToOrganization;
use Database\Factories\MessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['kind', 'body', 'payload'])]
class Message extends Model
{
    /** @use HasFactory<MessageFactory> */
    use BelongsToOrganization, HasFactory;

    public const UPDATED_AT = null;

    public const KIND_USER = 'user';

    public const KIND_SYSTEM = 'system';

    protected $dispatchesEvents = [
        'created' => MessageCreated::class,
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'last_reply_at' => 'datetime',
        ];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(Channel::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function logGroup(): BelongsTo
    {
        return $this->belongsTo(LogGroup::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function mentions(): HasMany
    {
        return $this->hasMany(MessageMention::class);
    }
}
