<?php

namespace App\Models;

use App\Enums\Locale;
use App\Enums\Role;
use Database\Factories\OrganizationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

#[Fillable(['name', 'slug', 'settings'])]
class Organization extends Model
{
    /** @use HasFactory<OrganizationFactory> */
    use HasFactory;

    public function __construct(array $attributes = [])
    {
        $this->attributes = [
            'settings' => json_encode(['default_locale' => Locale::default()->value]),
        ];

        parent::__construct($attributes);
    }

    protected function casts(): array
    {
        return [
            'settings' => 'array',
        ];
    }

    public static function uniqueSlugFor(string $name): string
    {
        $base = Str::slug($name) ?: 'organization';
        $slug = $base;

        for ($suffix = 2; static::query()->where('slug', $slug)->exists(); $suffix++) {
            $slug = "{$base}-{$suffix}";
        }

        return $slug;
    }

    /**
     * Retries on a concurrent slug collision. Each attempt runs in its own nested transaction so a failed
     * insert only rolls back to its savepoint and leaves the caller's Postgres transaction usable.
     */
    public static function createWithUniqueSlug(string $name, int $attempts = 3): static
    {
        for ($attempt = 1; ; $attempt++) {
            try {
                return DB::transaction(fn () => static::create([
                    'name' => $name,
                    'slug' => static::uniqueSlugFor($name),
                ]));
            } catch (UniqueConstraintViolationException $exception) {
                if ($attempt >= $attempts) {
                    throw $exception;
                }
            }
        }
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class)->withTimestamps();
    }

    /**
     * Membership plus roles; roles are scoped to this organization via the permission team.
     *
     * @param  array<Role>  $roles
     */
    public function addMember(User $user, array $roles): void
    {
        $this->users()->syncWithoutDetaching([$user->id]);

        $previousTeam = getPermissionsTeamId();
        setPermissionsTeamId($this->id);

        try {
            $user->unsetRelation('roles')->assignRole($roles);
        } finally {
            setPermissionsTeamId($previousTeam);
            $user->unsetRelation('roles');
        }
    }
}
