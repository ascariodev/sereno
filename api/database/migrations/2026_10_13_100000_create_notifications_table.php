<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('project_id')->nullable();
            $table->string('type', 64);
            $table->string('subject_type');
            $table->unsignedBigInteger('subject_id');
            $table->jsonb('data');
            $table->timestamp('read_at')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign(['project_id', 'organization_id'], 'notifications_project_organization_fk')
                ->references(['id', 'organization_id'])->on('projects')->cascadeOnDelete();
            $table->index(['user_id', 'organization_id', 'read_at']);
            $table->index(['subject_type', 'subject_id']);
            $table->index('project_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
