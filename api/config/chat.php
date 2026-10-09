<?php

return [

    'attachments' => [
        'disk' => env('CHAT_ATTACHMENTS_DISK', 'local'),
        'max_size_kb' => (int) env('CHAT_ATTACHMENT_MAX_KB', 5120),
        'max_per_message' => (int) env('CHAT_ATTACHMENTS_PER_MESSAGE', 10),
        'url_ttl_minutes' => (int) env('CHAT_ATTACHMENT_URL_TTL', 60),
        'orphan_hours' => (int) env('CHAT_ATTACHMENT_ORPHAN_HOURS', 24),
    ],

];
