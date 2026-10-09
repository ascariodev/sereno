<?php

namespace App\Models;

use App\Enums\Locale;
use App\Enums\Role;
use App\Events\MembershipRevoked;
use App\Events\MembershipRoleChanged;
use App\Exceptions\LastOwnerException;
use App\Jobs\TerminateUserConnections;
use Database\Factories\OrganizationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

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

    /**
     * Replaces the member's role in this organization.
     *
     * @throws LastOwnerException when it would demote the last owner
     * @throws ModelNotFoundException when the user is not a member
     */
    public function changeMemberRole(User $user, Role $role): void
    {
        $this->mutateMembership($user, function () use ($user, $role) {
            if ($role !== Role::Owner && $this->isLastOwner($user)) {
                throw new LastOwnerException;
            }

            $user->syncRoles([$role]);

            MembershipRoleChanged::dispatch($user->id, $this->id, $role->value);
        });
    }

    /**
     * Detaches the member and deletes their roles in this organization only.
     *
     * @throws LastOwnerException when the user is the last owner
     * @throws ModelNotFoundException when the user is not a member
     */
    public function removeMember(User $user): void
    {
        $this->mutateMembership($user, function () use ($user) {
            if ($this->isLastOwner($user)) {
                throw new LastOwnerException;
            }

            $user->syncRoles([]);
            $this->users()->detach($user->id);

            MembershipRevoked::dispatch($user->id, $this->id);
            $this->scheduleConnectionCut($user->id);
        });
    }

    /**
     * Delayed so `membership.revoked` reaches the client before its sockets close; a queue failure is reported
     * but must not fail a removal that is already committed.
     */
    private function scheduleConnectionCut(int $userId): void
    {
        DB::afterCommit(function () use ($userId) {
            try {
                TerminateUserConnections::dispatch($userId)->delay(5);
            } catch (Throwable $e) {
                report($e);
            }
        });
    }

    /**
     * Locking the organization row serializes every membership change of this organization, so the owner count
     * read inside the callback cannot be invalidated by a concurrent demotion or removal before commit.
     */
    private function mutateMembership(User $user, callable $mutation): void
    {
        DB::transaction(function () use ($user, $mutation) {
            static::query()->whereKey($this->id)->lockForUpdate()->firstOrFail();

            if (! $this->users()->whereKey($user->id)->exists()) {
                throw (new ModelNotFoundException)->setModel(User::class, [$user->id]);
            }

            $previousTeam = getPermissionsTeamId();
            setPermissionsTeamId($this->id);

            try {
                $user->unsetRelation('roles');
                $mutation();
            } finally {
                setPermissionsTeamId($previousTeam);
                $user->unsetRelation('roles');
            }
        });
    }

    private function isLastOwner(User $user): bool
    {
        $isOwner = $user->roles()->where('roles.name', Role::Owner->value)->exists();

        return $isOwner && ! $this->users()
            ->whereKeyNot($user->id)
            ->whereHas('roles', fn ($query) => $query->where('roles.name', Role::Owner->value))
            ->exists();
    }
}
