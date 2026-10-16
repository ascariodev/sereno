<?php

namespace App\Models;

use App\Enums\Locale;
use App\Enums\Role;
use App\Events\MembershipRevoked;
use App\Events\MembershipRoleChanged;
use App\Events\OrganizationMembersChanged;
use App\Events\ProjectMembersChanged;
use App\Exceptions\LastOwnerException;
use App\Jobs\TerminateUserConnections;
use Database\Factories\OrganizationFactory;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
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

            $losesProjectAccess = $role === Role::Member
                && $user->hasAnyRole([Role::Owner->value, Role::Admin->value]);

            $unchanged = $user->hasRole($role->value);

            $user->syncRoles([$role]);

            if ($unchanged) {
                return;
            }

            MembershipRoleChanged::dispatch($user->id, $this->id, $role->value);
            OrganizationMembersChanged::dispatch($this->id, $user->id);

            // Reverb does not re-authorize open subscriptions: channels of unassigned projects would stay open.
            if ($losesProjectAccess) {
                TerminateUserConnections::scheduleAfterCommit($user->id);
            }
        });
    }

    /**
     * Makes `$to` an owner and demotes `$from` to admin in one transaction, so the organization never has zero
     * owners nor needs two for the hand-over.
     *
     * @throws AuthorizationException when `$from` is no longer an owner by the time the lock is held
     * @throws ModelNotFoundException when either user is not a member
     */
    public function transferOwnership(User $from, User $to): void
    {
        $this->mutateMembership($from, function () use ($from, $to) {
            if (! $this->users()->whereKey($to->id)->exists()) {
                throw (new ModelNotFoundException)->setModel(User::class, [$to->id]);
            }

            if (! $from->hasRole(Role::Owner->value)) {
                throw new AuthorizationException;
            }

            $to->unsetRelation('roles');

            try {
                $targetWasOwner = $to->hasRole(Role::Owner->value);

                $to->syncRoles([Role::Owner]);
                $from->syncRoles([Role::Admin]);
            } finally {
                $to->unsetRelation('roles');
            }

            MembershipRoleChanged::dispatch($from->id, $this->id, Role::Admin->value);
            OrganizationMembersChanged::dispatch($this->id, $from->id);

            if (! $targetWasOwner) {
                MembershipRoleChanged::dispatch($to->id, $this->id, Role::Owner->value);
                OrganizationMembersChanged::dispatch($this->id, $to->id);
            }
        });
    }

    /**
     * Detaches the member, deletes their roles, project assignments, task assignments and access tokens in this organization only.
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

            $projectIds = DB::table('project_user')
                ->where('organization_id', $this->id)
                ->where('user_id', $user->id)
                ->pluck('project_id');

            DB::table('project_user')
                ->where('organization_id', $this->id)
                ->where('user_id', $user->id)
                ->delete();

            Task::unassignUser($this->id, $user->id);

            PersonalAccessToken::query()
                ->where('tokenable_type', $user->getMorphClass())
                ->where('tokenable_id', $user->id)
                ->where('organization_id', $this->id)
                ->delete();

            Project::query()
                ->withoutGlobalScopes()
                ->whereIn('id', $projectIds)
                ->get()
                ->each(fn (Project $project) => ProjectMembersChanged::dispatch($project));

            MembershipRevoked::dispatch($user->id, $this->id);
            OrganizationMembersChanged::dispatch($this->id, $user->id);
            TerminateUserConnections::scheduleAfterCommit($user->id);
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
