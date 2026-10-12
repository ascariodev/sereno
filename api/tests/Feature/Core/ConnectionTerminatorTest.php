<?php

use App\Realtime\ConnectionTerminator;
use Illuminate\Broadcasting\Broadcasters\PusherBroadcaster;
use Illuminate\Support\Facades\Broadcast;
use Pusher\ApiErrorException;
use Pusher\Pusher;

function useFakePusherConnection(Pusher $pusher): void
{
    Broadcast::extend('fake-pusher', fn () => new PusherBroadcaster($pusher));
    config([
        'broadcasting.connections.fake-pusher' => ['driver' => 'fake-pusher'],
        'broadcasting.default' => 'fake-pusher',
    ]);
}

it('terminates the user connections through the pusher api with the user id', function () {
    $pusher = Mockery::mock(Pusher::class);
    $pusher->shouldReceive('terminateUserConnections')->once()->with('43')->andReturn((object) []);
    useFakePusherConnection($pusher);

    app(ConnectionTerminator::class)->terminate(43);
});

it('does nothing with the null broadcaster', function () {
    config(['broadcasting.default' => 'null']);

    app(ConnectionTerminator::class)->terminate(43);
})->throwsNoExceptions();

it('does nothing with the log broadcaster', function () {
    config(['broadcasting.default' => 'log']);

    app(ConnectionTerminator::class)->terminate(43);
})->throwsNoExceptions();

it('propagates api errors so the queue can retry', function () {
    $pusher = Mockery::mock(Pusher::class);
    $pusher->shouldReceive('terminateUserConnections')->once()->andThrow(new ApiErrorException('unavailable', 503));
    useFakePusherConnection($pusher);

    app(ConnectionTerminator::class)->terminate(43);
})->throws(ApiErrorException::class, 'unavailable');

it('uses short http timeouts for reverb', function () {
    expect(config('broadcasting.connections.reverb.client_options'))
        ->toMatchArray(['connect_timeout' => 2.0, 'timeout' => 5.0]);
});
