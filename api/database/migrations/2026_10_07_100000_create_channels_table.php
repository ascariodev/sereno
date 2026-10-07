<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('channels', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'project_id']);
            $table->index('project_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('channels');
    }
};
