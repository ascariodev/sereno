<?php

namespace App\Console\Commands;

use App\Console\Concerns\ResolvesProjectByKey;
use App\Http\Requests\LogSource\StoreLogSourceRequest;
use App\Models\LogSource;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;

#[Signature('log:source-create {project : Project key} {name : Source name} {--organization= : Organization slug, needed when the key exists in several organizations}')]
#[Description('Create a log source for a project and print its key once')]
class CreateLogSource extends Command
{
    use ResolvesProjectByKey;

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

        if (! $project = $this->resolveProject()) {
            return self::FAILURE;
        }

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
