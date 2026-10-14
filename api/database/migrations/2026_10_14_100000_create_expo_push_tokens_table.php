<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expo_push_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('personal_access_token_id')->constrained('personal_access_tokens')->cascadeOnDelete();
            $table->string('token')->unique();
            $table->string('platform', 10);
            $table->string('device_name')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            $table->index('user_id');
            $table->index('personal_access_token_id');
        });

        DB::statement("ALTER TABLE expo_push_tokens ADD CONSTRAINT expo_push_tokens_platform_check CHECK (platform IN ('android', 'ios'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('expo_push_tokens');
    }
};
