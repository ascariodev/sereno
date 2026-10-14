<?php

use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

function assignMembersToAllProjects(): void
{
    DB::statement(<<<'SQL'
        INSERT INTO project_user (organization_id, project_id, user_id, created_at, updated_at)
        SELECT DISTINCT p.organization_id, p.id, mhr.model_id, NOW(), NOW()
        FROM model_has_roles mhr
        JOIN roles r ON r.id = mhr.role_id AND r.name = 'member'
        JOIN organization_user ou ON ou.organization_id = mhr.organization_id AND ou.user_id = mhr.model_id
        JOIN projects p ON p.organization_id = mhr.organization_id
        WHERE mhr.model_type = 'App\Models\User'
        ON CONFLICT (project_id, user_id) DO NOTHING
        SQL);
}

/**
 * Runs $change once, right before the first query that locks the organizations row with $lock ('for update',
 * 'for share'): simulates a concurrent change committed between the request's validation and its lock.
 */
function beforeOrganizationLock(string $lock, Closure $change): void
{
    $done = false;

    DB::beforeExecuting(function (string $query) use ($lock, $change, &$done) {
        if ($done || ! str_contains($query, 'from "organizations"') || ! str_ends_with($query, $lock)) {
            return;
        }

        $done = true;
        $change();
    });
}

/**
 * Archives the project right before the first query that locks its row: simulates archiving committed between the
 * request's validation and its transaction.
 */
function archiveProjectBeforeLock(Project $project): void
{
    $done = false;

    DB::beforeExecuting(function (string $query) use ($project, &$done) {
        if ($done || ! str_contains($query, 'from "projects"') || ! str_ends_with($query, 'for no key update')) {
            return;
        }

        $done = true;
        DB::table('projects')->where('id', $project->id)->update(['archived_at' => now()]);
    });
}

function withEnvironment(array $variables, Closure $callback): mixed
{
    $previous = [];

    foreach ($variables as $name => $value) {
        $previous[$name] = [getenv($name), $_ENV[$name] ?? null, $_SERVER[$name] ?? null];
        putenv("{$name}={$value}");
        $_ENV[$name] = $_SERVER[$name] = $value;
    }

    try {
        return $callback();
    } finally {
        foreach ($previous as $name => [$putenv, $envValue, $serverValue]) {
            putenv($putenv === false ? $name : "{$name}={$putenv}");
            $envValue === null ? Arr::forget($_ENV, $name) : $_ENV[$name] = $envValue;
            $serverValue === null ? Arr::forget($_SERVER, $name) : $_SERVER[$name] = $serverValue;
        }
    }
}
