<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $mismatched = Schema::getConnection()->table('project_user')
            ->join('projects', 'projects.id', '=', 'project_user.project_id')
            ->whereColumn('project_user.organization_id', '<>', 'projects.organization_id')
            ->count();

        throw_if($mismatched > 0, RuntimeException::class, "project_user has {$mismatched} row(s) whose organization_id differs from their project's; fix them before migrating.");

        Schema::table('projects', function (Blueprint $table) {
            $table->unique(['id', 'organization_id'], 'projects_id_organization_id_unique');
        });

        Schema::table('project_user', function (Blueprint $table) {
            $table->dropForeign(['project_id']);
            $table->foreign(['project_id', 'organization_id'], 'project_user_project_organization_fk')
                ->references(['id', 'organization_id'])->on('projects')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('project_user', function (Blueprint $table) {
            $table->dropForeign('project_user_project_organization_fk');
            $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
        });

        Schema::table('projects', function (Blueprint $table) {
            $table->dropUnique('projects_id_organization_id_unique');
        });
    }
};
