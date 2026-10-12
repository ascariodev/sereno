<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('task_comments', function (Blueprint $table) {
            $table->unique(['id', 'organization_id'], 'task_comments_id_organization_id_unique');
        });

        Schema::create('task_comment_mentions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('task_comment_id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign(['task_comment_id', 'organization_id'], 'task_comment_mentions_comment_organization_fk')
                ->references(['id', 'organization_id'])->on('task_comments')->cascadeOnDelete();
            $table->unique(['task_comment_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_comment_mentions');

        Schema::table('task_comments', function (Blueprint $table) {
            $table->dropUnique('task_comments_id_organization_id_unique');
        });
    }
};
