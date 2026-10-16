<?php

use App\Http\Controllers\Api\AccessTokenController;
use App\Http\Controllers\Api\AttachmentController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ChannelController;
use App\Http\Controllers\Api\ExpoPushTokenController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\LogGroupController;
use App\Http\Controllers\Api\LogIngestController;
use App\Http\Controllers\Api\LogSourceController;
use App\Http\Controllers\Api\MemberController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\OAuthAuthorizationController;
use App\Http\Controllers\Api\OauthConnectionController;
use App\Http\Controllers\Api\OrganizationController;
use App\Http\Controllers\Api\ProjectController;
use App\Http\Controllers\Api\ProjectMemberController;
use App\Http\Controllers\Api\PushSubscriptionController;
use App\Http\Controllers\Api\TaskCommentAttachmentController;
use App\Http\Controllers\Api\TaskCommentController;
use App\Http\Controllers\Api\TaskController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::get('registration', [AuthController::class, 'registration']);
    Route::post('register', [AuthController::class, 'register'])->middleware('throttle:register');
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:login');
    Route::post('logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('me', [AuthController::class, 'me']);
    Route::patch('me/locale', [AuthController::class, 'updateLocale']);
    Route::get('me/notification-preferences', [AuthController::class, 'notificationPreferences']);
    Route::patch('me/notification-preferences', [AuthController::class, 'updateNotificationPreferences']);
    Route::get('push/vapid-public-key', [PushSubscriptionController::class, 'vapidPublicKey']);
    Route::post('me/push-subscriptions', [PushSubscriptionController::class, 'store']);
    Route::delete('me/push-subscriptions', [PushSubscriptionController::class, 'destroy']);
    Route::post('me/expo-push-tokens', [ExpoPushTokenController::class, 'store']);
    Route::delete('me/expo-push-tokens', [ExpoPushTokenController::class, 'destroy']);
    Route::get('organizations', [OrganizationController::class, 'index']);
    Route::post('organizations', [OrganizationController::class, 'store']);
    Route::get('oauth/authorize', [OAuthAuthorizationController::class, 'show']);
    Route::post('oauth/authorize', [OAuthAuthorizationController::class, 'approve']);
    Route::delete('oauth/authorize', [OAuthAuthorizationController::class, 'deny']);
});

Route::get('invitations/{token}', [InvitationController::class, 'show'])->middleware('throttle:invitation-preview');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('invitations/accept', [InvitationController::class, 'accept']);
    Route::get('invitations', [InvitationController::class, 'index'])->middleware('organization');
    Route::post('invitations', [InvitationController::class, 'store'])->middleware('organization');
    Route::delete('invitations/{invitation}', [InvitationController::class, 'destroy'])->middleware('organization');
});

Route::middleware(['auth:sanctum', 'organization'])->group(function () {
    Route::get('access-tokens', [AccessTokenController::class, 'index']);
    Route::post('access-tokens', [AccessTokenController::class, 'store']);
    Route::delete('access-tokens/{id}', [AccessTokenController::class, 'destroy'])->whereNumber('id');
    Route::get('oauth-connections', [OauthConnectionController::class, 'index']);
    Route::delete('oauth-connections/{id}', [OauthConnectionController::class, 'destroy'])->whereNumber('id');
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
    Route::post('projects/{project}/tasks', [TaskController::class, 'store']);
    Route::get('projects/{project}/tasks/{task}', [TaskController::class, 'show']);
    Route::patch('projects/{project}/tasks/{task}', [TaskController::class, 'update']);
    Route::delete('projects/{project}/tasks/{task}', [TaskController::class, 'destroy']);
    Route::post('projects/{project}/tasks/{task}/move', [TaskController::class, 'move']);
    Route::get('projects/{project}/tasks/{task}/comments', [TaskCommentController::class, 'index']);
    Route::post('projects/{project}/tasks/{task}/comments', [TaskCommentController::class, 'store']);
    Route::patch('projects/{project}/tasks/{task}/comments/{comment}', [TaskCommentController::class, 'update'])->whereNumber('comment');
    Route::delete('projects/{project}/tasks/{task}/comments/{comment}', [TaskCommentController::class, 'destroy'])->whereNumber('comment');
    Route::post('projects/{project}/tasks/{task}/attachments', [TaskCommentAttachmentController::class, 'store'])->middleware('throttle:chat-attachments');
    Route::get('projects/{project}/members', [ProjectMemberController::class, 'index']);
    Route::post('projects/{project}/members', [ProjectMemberController::class, 'store']);
    Route::delete('projects/{project}/members/{user}', [ProjectMemberController::class, 'destroy'])->whereNumber('user');
    Route::get('members', [MemberController::class, 'index']);
    Route::patch('members/{user}', [MemberController::class, 'update']);
    Route::delete('members/{user}', [MemberController::class, 'destroy']);
    Route::post('members/{user}/transfer-ownership', [MemberController::class, 'transferOwnership'])->whereNumber('user');
    Route::get('channels', [ChannelController::class, 'index']);
    Route::get('channels/{channel}', [ChannelController::class, 'show'])->whereNumber('channel');
    Route::middleware('throttle:notifications')->group(function () {
        Route::get('notifications', [NotificationController::class, 'index']);
        Route::post('notifications/read', [NotificationController::class, 'read']);
    });

    Route::get('channels/{channel}/messages', [MessageController::class, 'index']);
    Route::get('channels/{channel}/messages/{message}/replies', [MessageController::class, 'replies'])->whereNumber('message');
    Route::post('channels/{channel}/messages', [MessageController::class, 'store'])->middleware('throttle:channel-messages');
    Route::patch('channels/{channel}/messages/{message}', [MessageController::class, 'update'])->whereNumber('message')->middleware('throttle:channel-messages');
    Route::delete('channels/{channel}/messages/{message}', [MessageController::class, 'destroy'])->whereNumber('message')->middleware('throttle:channel-messages');
    Route::get('attachments/{attachment}/url', [AttachmentController::class, 'url'])->whereNumber('attachment')->middleware('throttle:attachment-urls');
    Route::post('channels/{channel}/attachments', [AttachmentController::class, 'store'])->middleware('throttle:chat-attachments');
    Route::get('task-attachments/{attachment}/url', [TaskCommentAttachmentController::class, 'url'])->whereNumber('attachment')->middleware('throttle:attachment-urls');
});

// No Bearer nor organization: the signed URL is the credential, so it works from <img> and is generated without
// a tenant (queue worker). Relative signature: validated on path and query, whatever host the proxy forwards.
Route::get('attachments/{attachment}', [AttachmentController::class, 'download'])
    ->whereNumber('attachment')
    ->middleware(['throttle:attachment-downloads', 'signed:relative'])
    ->name('attachments.download');

Route::get('task-attachments/{attachment}', [TaskCommentAttachmentController::class, 'download'])
    ->whereNumber('attachment')
    ->middleware(['throttle:attachment-downloads', 'signed:relative'])
    ->name('task-attachments.download');

Route::middleware(['log.source', 'throttle:log-ingest'])->group(function () {
    Route::post('ingest/events', [LogIngestController::class, 'store']);
});
