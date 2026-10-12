<?php

use Illuminate\Support\Facades\DB;

it('responds on the health route', function () {
    $this->get('/up')->assertOk();
});

it('runs tests against the postgres test database', function () {
    expect(DB::connection()->getDriverName())->toBe('pgsql')
        ->and(DB::connection()->getDatabaseName())->toBe('workspace_test');
});
