<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->integer('last_task_number')->default(0);
        });

        Schema::create('tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->integer('number');
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->string('status', 16)->default('todo');
            $table->double('position');
            $table->foreignId('assignee_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('log_group_id')->nullable()->constrained('log_groups')->nullOnDelete();
            $table->timestamps();

            $table->unique(['project_id', 'number']);
            $table->index(['project_id', 'status', 'position']);
            $table->index('organization_id');
        });

        DB::statement("ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo', 'in_progress', 'in_review', 'done'))");
        DB::statement('CREATE UNIQUE INDEX tasks_log_group_id_unique ON tasks (log_group_id) WHERE log_group_id IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('tasks');

        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn('last_task_number');
        });
    }
};
