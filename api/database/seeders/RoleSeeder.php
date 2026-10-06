<?php

namespace Database\Seeders;

use App\Enums\Role;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Role as RoleModel;
use Spatie\Permission\PermissionRegistrar;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        // Global roles (organization_id null): assignment to each user is still per organization.
        setPermissionsTeamId(null);

        foreach (Role::cases() as $role) {
            RoleModel::findOrCreate($role->value, 'web');
        }
    }
}
