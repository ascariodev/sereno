<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->unique(['id', 'organization_id'], 'tasks_id_organization_id_unique');
        });

        Schema::create('task_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('task_id');
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->text('body');
            $table->timestamps();

            $table->foreign(['task_id', 'organization_id'], 'task_comments_task_organization_fk')
                ->references(['id', 'organization_id'])->on('tasks')->cascadeOnDelete();
            $table->index(['task_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_comments');

        Schema::table('tasks', function (Blueprint $table) {
            $table->dropUnique('tasks_id_organization_id_unique');
        });
    }
};
