<?php

namespace App\Console\Concerns;

use App\Models\Project;
use App\Models\Scopes\OrganizationScope;

trait ResolvesProjectByKey
{
    protected function resolveProject(): ?Project
    {
        $key = strtoupper((string) $this->argument('project'));

        $projects = Project::query()
            ->withoutGlobalScope(OrganizationScope::class)
            ->where('key', $key)
            ->when($this->option('organization'), fn ($query, $slug) => $query->whereHas(
                'organization',
                fn ($organization) => $organization->where('slug', $slug),
            ))
            ->limit(2)
            ->get();

        if ($projects->isEmpty()) {
            $slug = $this->option('organization');
            $this->components->error($slug
                ? __('Project :project not found in organization :organization.', ['project' => $key, 'organization' => $slug])
                : __('Project :project not found.', ['project' => $key]));

            return null;
        }

        if ($projects->count() > 1) {
            $this->components->error(__('Several projects match :project; pass --organization with the organization slug.', ['project' => $key]));

            return null;
        }

        return $projects->first();
    }
}
