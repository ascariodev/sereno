<?php

namespace App\Mcp\Servers;

use App\Mcp\Tools\GetTaskTool;
use App\Mcp\Tools\ListChannelMessagesTool;
use App\Mcp\Tools\ListProjectsTool;
use App\Mcp\Tools\ListTasksTool;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;

#[Name('Sereno')]
#[Version('1.0.0')]
#[Instructions(<<<'MARKDOWN'
    Sereno is a team workspace with projects, tasks, project channels and log alerts. Every request acts as the user who
    owns the access token, with that user's permissions, inside the single organization the token belongs to.
    MARKDOWN)]
class SerenoServer extends Server
{
    protected array $tools = [
        ListProjectsTool::class,
        ListTasksTool::class,
        GetTaskTool::class,
        ListChannelMessagesTool::class,
    ];

    protected array $resources = [];

    protected array $prompts = [];
}
