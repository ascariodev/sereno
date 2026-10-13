<?php

return [

    'log' => [
        'retention_days' => (int) env('LOG_RETENTION_DAYS', 30),
        // Failed ingestion authentications (missing, invalid or revoked key) allowed per IP within the window.
        'auth_failures' => [
            'max_attempts' => (int) env('LOG_INGEST_AUTH_MAX_FAILURES', 30),
            'decay_seconds' => (int) env('LOG_INGEST_AUTH_FAILURE_WINDOW', 60),
        ],
    ],

    'notifications' => [
        // Minutes the email waits; it is skipped if the inbox notification was read meanwhile.
        'mail_delay_minutes' => (int) env('NOTIFICATION_MAIL_DELAY_MINUTES', 5),
    ],

    'push' => [
        'vapid_public_key' => env('VAPID_PUBLIC_KEY'),
        'vapid_private_key' => env('VAPID_PRIVATE_KEY'),
        'vapid_subject' => env('VAPID_SUBJECT'),
    ],

];
