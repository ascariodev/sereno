<?php

namespace App\Policies\Concerns;

use App\Enums\Role;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\Eloquent\Model;

trait ChecksActiveOrganization
{
    private function canManage(User $user): bool
    {
        return $this->hasActiveOrganization()
            && $user->hasAnyRole([Role::Owner->value, Role::Admin->value]);
    }

    private function hasActiveOrganization(): bool
    {
        return app(CurrentOrganization::class)->id() !== null;
    }

    private function belongsToActiveOrganization(Model $model): bool
    {
        $activeId = app(CurrentOrganization::class)->id();

        return $activeId !== null && $model->organization_id === $activeId;
    }
}
