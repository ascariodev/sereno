<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use App\Models\Scopes\OrganizationScope;
use Database\Factories\InvitationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

#[Fillable(['email', 'role', 'token', 'locale', 'invited_by', 'expires_at', 'accepted_at'])]
#[Hidden(['token'])]
class Invitation extends Model
{
    /** @use HasFactory<InvitationFactory> */
    use BelongsToOrganization, HasFactory;

    public const VALID_DAYS = 7;

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
        ];
    }

    public static function hashToken(string $plainToken): string
    {
        return hash('sha256', $plainToken);
    }

    public static function newPlainToken(): string
    {
        return Str::random(48);
    }

    /**
     * Lookup by plain token across organizations: the accepting user is not a member yet, so there is
     * no active organization. The token hash is the only key; the caller must validate the result.
     */
    public static function findByPlainToken(string $plainToken, bool $lock = false): ?self
    {
        $query = static::query()
            ->withoutGlobalScope(OrganizationScope::class)
            ->where('token', static::hashToken($plainToken));

        return ($lock ? $query->lockForUpdate() : $query)->first();
    }

    public function scopePending(Builder $query): void
    {
        $query->whereNull('accepted_at')->where('expires_at', '>', now());
    }

    public function isUsable(): bool
    {
        return $this->accepted_at === null && $this->expires_at->isFuture();
    }

    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }
}
