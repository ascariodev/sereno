<?php

return [

    'authorization_server' => env('MCP_AUTHORIZATION_SERVER'),

    // The package merges config shallowly, so these replace its defaults. Its check is a prefix match on the
    // full URL, so the entry ends at a path separator: only that exact host and path prefix passes.
    'redirect_domains' => ['https://claude.ai/api/mcp/'],

    'custom_schemes' => [],

];
