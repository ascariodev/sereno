<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('message_mentions', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'organization_id', 'read_at']);
            $table->dropColumn('read_at');
        });
    }

    public function down(): void
    {
        Schema::table('message_mentions', function (Blueprint $table) {
            $table->timestamp('read_at')->nullable();
            $table->index(['user_id', 'organization_id', 'read_at']);
        });
    }
};
