<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invitation_project', function (Blueprint $table) {
            $table->foreignId('invitation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();

            $table->primary(['invitation_id', 'project_id']);
            $table->index('project_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invitation_project');
    }
};
