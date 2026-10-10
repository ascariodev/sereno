<?php

use App\Http\Controllers\Api\AttachmentController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ChannelController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\LogGroupController;
use App\Http\Controllers\Api\LogIngestController;
use App\Http\Controllers\Api\LogSourceController;
use App\Http\Controllers\Api\MemberController;
use App\Http\Controllers\Api\MentionController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\OrganizationController;
use App\Http\Controllers\Api\ProjectController;
use App\Http\Controllers\Api\TaskController;
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

Route::get('invitations/{token}', [InvitationController::class, 'show'])->middleware('throttle:invitation-preview');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('invitations/accept', [InvitationController::class, 'accept']);
    Route::get('invitations', [InvitationController::class, 'index'])->middleware('organization');
    Route::post('invitations', [InvitationController::class, 'store'])->middleware('organization');
    Route::delete('invitations/{invitation}', [InvitationController::class, 'destroy'])->middleware('organization');
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
    Route::get('projects/{project}/log-groups/hourly', [LogGroupController::class, 'hourly']);
    Route::get('projects/{project}/log-groups/{group}', [LogGroupController::class, 'show']);
    Route::patch('projects/{project}/log-groups/{group}', [LogGroupController::class, 'update']);
    Route::get('projects/{project}/tasks', [TaskController::class, 'index']);
    Route::get('members', [MemberController::class, 'index']);
    Route::patch('members/{user}', [MemberController::class, 'update']);
    Route::delete('members/{user}', [MemberController::class, 'destroy']);
    Route::get('channels', [ChannelController::class, 'index']);
    Route::middleware('throttle:mentions')->group(function () {
        Route::get('mentions', [MentionController::class, 'index']);
        Route::post('mentions/read', [MentionController::class, 'read']);
    });

    Route::get('channels/{channel}/messages', [MessageController::class, 'index']);
    Route::get('channels/{channel}/messages/{message}/replies', [MessageController::class, 'replies'])->whereNumber('message');
    Route::post('channels/{channel}/messages', [MessageController::class, 'store'])->middleware('throttle:channel-messages');
    Route::patch('channels/{channel}/messages/{message}', [MessageController::class, 'update'])->whereNumber('message')->middleware('throttle:channel-messages');
    Route::delete('channels/{channel}/messages/{message}', [MessageController::class, 'destroy'])->whereNumber('message')->middleware('throttle:channel-messages');
    Route::post('channels/{channel}/attachments', [AttachmentController::class, 'store'])->middleware('throttle:chat-attachments');
});

// No Bearer nor organization: the signed URL is the credential, so it works from <img> and is generated without
// a tenant (queue worker). Relative signature: validated on path and query, whatever host the proxy forwards.
Route::get('attachments/{attachment}', [AttachmentController::class, 'download'])
    ->whereNumber('attachment')
    ->middleware(['throttle:attachment-downloads', 'signed:relative'])
    ->name('attachments.download');

Route::middleware(['log.source', 'throttle:log-ingest'])->group(function () {
    Route::post('ingest/events', [LogIngestController::class, 'store']);
});
