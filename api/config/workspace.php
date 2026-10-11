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

];
