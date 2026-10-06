<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use App\Models\Concerns\EnsuresProjectInOrganization;
use App\Models\Scopes\OrganizationScope;
use Database\Factories\LogSourceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

#[Fillable(['name', 'key_hash', 'key_prefix'])]
#[Hidden(['key_hash'])]
class LogSource extends Model
{
    /** @use HasFactory<LogSourceFactory> */
    use BelongsToOrganization, EnsuresProjectInOrganization, HasFactory;

    public const KEY_PREFIX = 'wsk_';

    public const KEY_RANDOM_LENGTH = 40;

    public const DISPLAY_PREFIX_LENGTH = 12;

    public const LAST_USED_RESOLUTION_SECONDS = 60;

    protected function casts(): array
    {
        return [
            'last_used_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public static function newPlainKey(): string
    {
        return self::KEY_PREFIX.Str::random(self::KEY_RANDOM_LENGTH);
    }

    public static function isWellFormedPlainKey(string $plainKey): bool
    {
        return preg_match('/\A'.preg_quote(self::KEY_PREFIX, '/').'[A-Za-z0-9]{'.self::KEY_RANDOM_LENGTH.'}\z/', $plainKey) === 1;
    }

    public static function hashKey(string $plainKey): string
    {
        return hash('sha256', $plainKey);
    }

    public static function displayPrefix(string $plainKey): string
    {
        return substr($plainKey, 0, self::DISPLAY_PREFIX_LENGTH);
    }

    /**
     * Lookup by plain key across organizations: ingestion has no active organization, it comes from
     * the source. The key hash is the only key; the caller must check revocation and the project.
     */
    public static function findByPlainKey(string $plainKey): ?self
    {
        return static::query()
            ->withoutGlobalScope(OrganizationScope::class)
            ->where('key_hash', static::hashKey($plainKey))
            ->first();
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    /**
     * At most one write per resolution window: the condition lives in the UPDATE so concurrent
     * requests do not need a cache or a lock, and updated_at is left untouched.
     */
    public function markAsUsed(): void
    {
        $now = now();

        $updated = static::query()
            ->withoutGlobalScope(OrganizationScope::class)
            ->whereKey($this->getKey())
            ->where(fn ($query) => $query
                ->whereNull('last_used_at')
                ->orWhere('last_used_at', '<', $now->copy()->subSeconds(self::LAST_USED_RESOLUTION_SECONDS)))
            ->toBase()
            ->update(['last_used_at' => $now]);

        if ($updated > 0) {
            $this->forceFill(['last_used_at' => $now])->syncOriginalAttribute('last_used_at');
        }
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }
}
