<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Enums\Locale;
use App\Enums\NotificationType;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Translation\HasLocalePreference;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use LogicException;
use Spatie\Permission\Models\Role;
use Spatie\Permission\Traits\HasRoles;

#[Fillable(['name', 'email', 'password', 'locale', 'notification_preferences'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements HasLocalePreference
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRoles, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'locale' => Locale::class,
            'notification_preferences' => 'array',
        ];
    }

    public function preferredLocale(): ?string
    {
        return $this->locale?->value;
    }

    public function wantsEmail(NotificationType $type): bool
    {
        return $this->wantsChannel('email', $type);
    }

    public function wantsPush(NotificationType $type): bool
    {
        return $this->wantsChannel('push', $type);
    }

    private function wantsChannel(string $channel, NotificationType $type): bool
    {
        return ($this->notification_preferences[$channel][$type->value] ?? true) !== false;
    }

    /** @return array{email: array<string, bool>, push: array<string, bool>} */
    public function notificationPreferences(): array
    {
        $types = collect(NotificationType::cases());

        return [
            'email' => $types->mapWithKeys(fn (NotificationType $type) => [$type->value => $this->wantsEmail($type)])->all(),
            'push' => $types->mapWithKeys(fn (NotificationType $type) => [$type->value => $this->wantsPush($type)])->all(),
        ];
    }

    public function notifications(): HasMany
    {
        return $this->hasMany(AppNotification::class);
    }

    public function pushSubscriptions(): HasMany
    {
        return $this->hasMany(PushSubscription::class);
    }

    public function readNotifications(): never
    {
        throw new LogicException('Use notifications() filtered by read_at; the Notifiable helpers target the database channel.');
    }

    public function unreadNotifications(): never
    {
        throw new LogicException('Use notifications() filtered by read_at; the Notifiable helpers target the database channel.');
    }

    public function organizations(): BelongsToMany
    {
        return $this->belongsToMany(Organization::class)->withTimestamps();
    }

    public function projects(): BelongsToMany
    {
        return $this->belongsToMany(Project::class)->withPivot('organization_id')->withTimestamps();
    }

    /**
     * Roles in every organization, without the active-team filter that roles() applies.
     */
    public function rolesInOrganizations(): MorphToMany
    {
        return $this->morphToMany(Role::class, 'model', 'model_has_roles', 'model_id', 'role_id')
            ->withPivot('organization_id');
    }

    /**
     * @return Collection<int, Organization>
     */
    public function organizationsWithRoles(): Collection
    {
        $this->loadMissing(['organizations', 'rolesInOrganizations']);

        return $this->organizations->each(fn (Organization $organization) => $organization->setRelation(
            'roles',
            $this->rolesInOrganizations->where('pivot.organization_id', $organization->id)->values(),
        ));
    }
}
