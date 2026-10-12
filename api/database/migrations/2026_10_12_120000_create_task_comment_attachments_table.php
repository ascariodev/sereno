<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('task_comment_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('task_id');
            $table->unsignedBigInteger('task_comment_id')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('disk', 30);
            $table->string('path', 255);
            $table->string('original_name', 255);
            $table->string('mime', 127);
            $table->unsignedBigInteger('size');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign(['task_id', 'organization_id'], 'task_comment_attachments_task_organization_fk')
                ->references(['id', 'organization_id'])->on('tasks')->cascadeOnDelete();
            $table->foreign(['task_comment_id', 'organization_id'], 'task_comment_attachments_comment_organization_fk')
                ->references(['id', 'organization_id'])->on('task_comments')->cascadeOnDelete();
            $table->index('task_id');
            $table->index('task_comment_id');
        });

        DB::statement('CREATE INDEX task_comment_attachments_orphans_index ON task_comment_attachments (created_at) WHERE task_comment_id IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('task_comment_attachments');
    }
};
