<?php

namespace App\Enums;

enum NotificationType: string
{
    case TaskAssigned = 'task_assigned';
    case TaskCommentMention = 'task_comment_mention';
    case TaskCommented = 'task_commented';
    case ChatMention = 'chat_mention';
}
