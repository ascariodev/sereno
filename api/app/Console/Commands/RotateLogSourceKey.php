<?php

namespace App\Console\Commands;

use App\Console\Concerns\ResolvesProjectByKey;
use App\Models\LogSource;
use App\Models\Scopes\OrganizationScope;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('log:source-rotate {project : Project key} {name? : Source name, unique within the project} {--id= : Source id, needed when several sources share the name} {--organization= : Organization slug, needed when the key exists in several organizations}')]
#[Description('Rotate the key of a log source and print the new key once')]
class RotateLogSourceKey extends Command
{
    use ResolvesProjectByKey;

    public function handle(): int
    {
        $name = $this->argument('name');
        $id = $this->option('id');

        if (($name === null || $name === '') === ($id === null || $id === '')) {
            $this->components->error(__('Pass either the source name or --id.'));

            return self::FAILURE;
        }

        if (! $project = $this->resolveProject()) {
            return self::FAILURE;
        }

        $sources = LogSource::query()
            ->withoutGlobalScope(OrganizationScope::class)
            ->where('project_id', $project->id)
            ->when($id !== null && $id !== '', fn ($query) => $query->whereKey(ctype_digit((string) $id) ? (int) $id : 0))
            ->when($id === null || $id === '', fn ($query) => $query->where('name', $name))
            ->limit(2)
            ->get();

        if ($sources->isEmpty()) {
            $this->components->error(__('Log source not found in project :project.', ['project' => $project->key]));

            return self::FAILURE;
        }

        if ($sources->count() > 1) {
            $this->components->error(__('Several log sources are named :name in project :project; pass --id with the source id.', ['name' => $name, 'project' => $project->key]));

            return self::FAILURE;
        }

        $source = $sources->first();

        if ($errors = $source->rotationErrors($project)) {
            foreach ($errors as $message) {
                $this->components->error($message);
            }

            return self::FAILURE;
        }

        if (($plainKey = $source->rotateKey()) === null) {
            $this->components->error(__('The log source key was changed or revoked by another request. Reload and try again.'));

            return self::FAILURE;
        }

        $this->components->info(__('Log source key rotated. Copy the key now, it will not be shown again.'));
        $this->line($plainKey);

        return self::SUCCESS;
    }
}
