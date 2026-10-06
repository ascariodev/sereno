<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\OrganizationController;
use App\Http\Controllers\Api\ProjectController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::post('register', [AuthController::class, 'register']);
    Route::post('login', [AuthController::class, 'login']);
    Route::post('logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('me', [AuthController::class, 'me']);
    Route::patch('me/locale', [AuthController::class, 'updateLocale']);
    Route::get('organizations', [OrganizationController::class, 'index']);
    Route::post('organizations', [OrganizationController::class, 'store']);
});

Route::middleware('auth:sanctum')->group(function () {
    Route::post('invitations/accept', [InvitationController::class, 'accept']);
    Route::post('invitations', [InvitationController::class, 'store'])->middleware('organization');
});

Route::middleware(['auth:sanctum', 'organization'])->group(function () {
    Route::get('projects', [ProjectController::class, 'index']);
    Route::post('projects', [ProjectController::class, 'store']);
    Route::get('projects/{project}', [ProjectController::class, 'show']);
    Route::patch('projects/{project}', [ProjectController::class, 'update']);
    Route::post('projects/{project}/archive', [ProjectController::class, 'archive']);
    Route::delete('projects/{project}/archive', [ProjectController::class, 'unarchive']);
});
