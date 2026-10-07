<?php

namespace App\Console\Commands;

use App\Http\Requests\LogSource\StoreLogSourceRequest;
use App\Models\LogSource;
use App\Models\Project;
use App\Models\Scopes\OrganizationScope;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;

#[Signature('log:source-create {project : Project key} {name : Source name} {--organization= : Organization slug, needed when the key exists in several organizations}')]
#[Description('Create a log source for a project and print its key once')]
class CreateLogSource extends Command
{
    public function handle(): int
    {
        $validator = Validator::make(
            ['name' => $this->argument('name')],
            (new StoreLogSourceRequest)->rules(),
        );

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $message) {
                $this->components->error($message);
            }

            return self::FAILURE;
        }

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
            $this->components->error(__('Project :project not found.', ['project' => $key]));

            return self::FAILURE;
        }

        if ($projects->count() > 1) {
            $this->components->error(__('Several projects match :project; pass --organization with the organization slug.', ['project' => $key]));

            return self::FAILURE;
        }

        $project = $projects->first();

        if ($error = $project->logSourceCreationError()) {
            $this->components->error($error);

            return self::FAILURE;
        }

        [, $plainKey] = LogSource::issueFor($project, (string) $this->argument('name'));

        $this->components->info(__('Log source created. Copy the key now, it will not be shown again.'));
        $this->line($plainKey);

        return self::SUCCESS;
    }
}
