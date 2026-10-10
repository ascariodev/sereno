<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
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
