<?php

namespace App\Models;

use App\Enums\Role;
use Database\Factories\OrganizationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Str;

#[Fillable(['name', 'slug', 'settings'])]
class Organization extends Model
{
    /** @use HasFactory<OrganizationFactory> */
    use HasFactory;

    protected $attributes = [
        'settings' => '{"default_locale": "en"}',
    ];

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
