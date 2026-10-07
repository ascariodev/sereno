<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ChannelController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\LogGroupController;
use App\Http\Controllers\Api\LogIngestController;
use App\Http\Controllers\Api\LogSourceController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\OrganizationController;
use App\Http\Controllers\Api\ProjectController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::post('register', [AuthController::class, 'register'])->middleware('throttle:register');
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:login');
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
    Route::get('projects/{project}/log-sources', [LogSourceController::class, 'index']);
    Route::post('projects/{project}/log-sources', [LogSourceController::class, 'store']);
    Route::delete('projects/{project}/log-sources/{source}', [LogSourceController::class, 'destroy']);
    Route::post('projects/{project}/log-sources/{source}/rotate-key', [LogSourceController::class, 'rotateKey']);
    Route::get('projects/{project}/log-groups', [LogGroupController::class, 'index']);
    Route::get('projects/{project}/log-groups/{group}', [LogGroupController::class, 'show']);
    Route::patch('projects/{project}/log-groups/{group}', [LogGroupController::class, 'update']);
    Route::get('channels', [ChannelController::class, 'index']);
    Route::get('channels/{channel}/messages', [MessageController::class, 'index']);
    Route::post('channels/{channel}/messages', [MessageController::class, 'store'])->middleware('throttle:channel-messages');
});

Route::middleware(['log.source', 'throttle:log-ingest'])->group(function () {
    Route::post('ingest/events', [LogIngestController::class, 'store']);
});
