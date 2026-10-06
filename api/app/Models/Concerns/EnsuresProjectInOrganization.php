<?php

namespace App\Models\Concerns;

use App\Models\Project;
use App\Models\Scopes\OrganizationScope;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

trait EnsuresProjectInOrganization
{
    protected static function bootEnsuresProjectInOrganization(): void
    {
        $assertProjectInOrganization = function (Model $model) {
            if (! $model->isDirty(['organization_id', 'project_id'])) {
                return;
            }

            $projectOrganizationId = Project::query()
                ->withoutGlobalScope(OrganizationScope::class)
                ->whereKey($model->project_id)
                ->value('organization_id');

            if ($projectOrganizationId === null || (int) $projectOrganizationId !== (int) $model->organization_id) {
                throw new InvalidArgumentException('The project must belong to the model organization.');
            }
        };

        static::creating($assertProjectInOrganization);
        static::updating($assertProjectInOrganization);
    }
}
