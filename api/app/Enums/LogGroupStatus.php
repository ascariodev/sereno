<?php

namespace App\Enums;

enum LogGroupStatus: string
{
    case Open = 'open';
    case Resolved = 'resolved';
    case Ignored = 'ignored';
}
