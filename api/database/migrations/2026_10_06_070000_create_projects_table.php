<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('key', 10);
            $table->text('description')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'key']);
        });

        // Jira-style key: starts with a letter, then uppercase letters or digits, 2-10 chars.
        DB::statement("ALTER TABLE projects ADD CONSTRAINT projects_key_check CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$')");
    }

    public function down(): void
    {
        Schema::dropIfExists('projects');
    }
};
