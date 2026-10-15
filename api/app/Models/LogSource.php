<?php

namespace App\Models;

use App\Enums\LogSourceKind;
use App\Events\LogSourceConnected;
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

#[Fillable(['name', 'kind', 'allowed_origins', 'key_hash', 'key_prefix'])]
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
            'kind' => LogSourceKind::class,
            'allowed_origins' => 'array',
            'last_used_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public static function newPlainKey(LogSourceKind $kind = LogSourceKind::Server): string
    {
        return $kind->keyPrefix().Str::random(self::KEY_RANDOM_LENGTH);
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
     * Server sources never store origins; browser sources need at least one (a CHECK enforces both).
     *
     * @param  list<string>  $allowedOrigins  normalized origins, only kept for browser sources
     * @return array{0: self, 1: string} the source and its plain key, which is never stored.
     */
    public static function issueFor(
        Project $project,
        string $name,
        LogSourceKind $kind = LogSourceKind::Server,
        array $allowedOrigins = [],
    ): array {
        $plainKey = static::newPlainKey($kind);

        $source = $project->logSources()->make([
            'name' => $name,
            'kind' => $kind,
            'allowed_origins' => $kind === LogSourceKind::Browser ? array_values($allowedOrigins) : null,
            ...static::keyAttributes($plainKey),
        ]);
        $source->organization_id = $project->organization_id;
        $source->save();

        return [$source, $plainKey];
    }

    /** @return array<string, string> error message by field, empty when the key can be rotated. */
    public function rotationErrors(Project $project): array
    {
        return array_filter([
            'project' => $project->isArchived() ? __('This project is archived and its log source keys cannot be rotated.') : null,
            'source' => $this->isRevoked() ? __('This log source is revoked and its key cannot be rotated.') : null,
        ]);
    }

    /**
     * Replaces the key in place: the previous one stops authenticating as soon as this is saved.
     * The UPDATE is conditioned on the key hash this instance read and on the source not being
     * revoked, so a concurrent rotation or revocation wins and this one returns null.
     */
    public function rotateKey(): ?string
    {
        $plainKey = static::newPlainKey($this->kind ?? LogSourceKind::Server);
        $attributes = [
            ...static::keyAttributes($plainKey),
            'last_used_at' => null,
            $this->getUpdatedAtColumn() => $this->freshTimestamp(),
        ];

        $updated = static::query()
            ->withoutGlobalScope(OrganizationScope::class)
            ->whereKey($this->getKey())
            ->where('key_hash', $this->getOriginal('key_hash'))
            ->whereNull('revoked_at')
            ->toBase()
            ->update($attributes);

        if ($updated === 0) {
            return null;
        }

        $this->forceFill($attributes)->syncOriginalAttributes(array_keys($attributes));

        return $plainKey;
    }

    /** @return array{key_hash: string, key_prefix: string} */
    private static function keyAttributes(string $plainKey): array
    {
        return [
            'key_hash' => static::hashKey($plainKey),
            'key_prefix' => static::displayPrefix($plainKey),
        ];
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
     * requests do not need a cache or a lock, and updated_at is left untouched. The first use of
     * the key (null to a value) is announced once: of two concurrent first requests only one
     * UPDATE affects the row, and the other one writes nothing.
     */
    public function markAsUsed(): void
    {
        $now = now();
        $isFirstUse = $this->getOriginal('last_used_at') === null;

        $query = static::query()
            ->withoutGlobalScope(OrganizationScope::class)
            ->whereKey($this->getKey());

        if ($isFirstUse) {
            $query->whereNull('last_used_at');
        } else {
            $query->where('last_used_at', '<', $now->copy()->subSeconds(self::LAST_USED_RESOLUTION_SECONDS));
        }

        if ($query->toBase()->update(['last_used_at' => $now]) === 0) {
            return;
        }

        $this->forceFill(['last_used_at' => $now])->syncOriginalAttribute('last_used_at');

        if ($isFirstUse) {
            LogSourceConnected::dispatch($this);
        }
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }
}
