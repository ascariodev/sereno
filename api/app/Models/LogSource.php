<?php

namespace App\Models;

use App\Models\Concerns\BelongsToOrganization;
use App\Models\Scopes\OrganizationScope;
use Database\Factories\LogSourceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;
use InvalidArgumentException;

#[Fillable(['name', 'key_hash', 'key_prefix'])]
#[Hidden(['key_hash'])]
class LogSource extends Model
{
    /** @use HasFactory<LogSourceFactory> */
    use BelongsToOrganization, HasFactory;

    public const KEY_PREFIX = 'wsk_';

    public const DISPLAY_PREFIX_LENGTH = 12;

    protected static function booted(): void
    {
        $assertProjectInOrganization = function (self $source) {
            if (! $source->isDirty(['organization_id', 'project_id'])) {
                return;
            }

            $projectOrganizationId = Project::query()
                ->withoutGlobalScope(OrganizationScope::class)
                ->whereKey($source->project_id)
                ->value('organization_id');

            if ($projectOrganizationId === null || (int) $projectOrganizationId !== (int) $source->organization_id) {
                throw new InvalidArgumentException('The project must belong to the log source organization.');
            }
        };

        static::creating($assertProjectInOrganization);
        static::updating($assertProjectInOrganization);
    }

    protected function casts(): array
    {
        return [
            'last_used_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public static function newPlainKey(): string
    {
        return self::KEY_PREFIX.Str::random(40);
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

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }
}
