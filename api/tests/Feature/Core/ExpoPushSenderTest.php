<?php

use App\Models\ExpoPushToken;
use App\Support\ExpoPushSender;
use App\Support\MobilePushSender;
use App\Support\PushSender;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/** @return list<ExpoPushToken> */
function expoSenderTokens(int $count): array
{
    return array_map(function (int $id) {
        $token = new ExpoPushToken(['token' => "ExponentPushToken[token-{$id}]", 'platform' => 'android']);
        $token->id = $id;

        return $token;
    }, range(1, $count));
}

/** @return array{title: string, body: string, data: array<string, mixed>} */
function expoSenderMessage(): array
{
    return ['title' => 'Ana mentioned you', 'body' => 'Hello', 'data' => ['url' => '/x', 'organizationId' => 7]];
}

it('is the bound mobile push sender', function () {
    expect(app(MobilePushSender::class))->toBeInstanceOf(ExpoPushSender::class);
});

it('sends one message per token and marks the accepted tickets as sent', function () {
    config(['workspace.push.expo_access_token' => null]);
    Http::fake([ExpoPushSender::URL => Http::response(['data' => [
        ['status' => 'ok', 'id' => 'a'],
        ['status' => 'ok', 'id' => 'b'],
    ]])]);

    $results = (new ExpoPushSender)->send(expoSenderTokens(2), expoSenderMessage());

    expect($results)->toBe([1 => PushSender::SENT, 2 => PushSender::SENT]);
    Http::assertSentCount(1);
    Http::assertSent(fn (Request $request) => $request->method() === 'POST'
        && $request->url() === ExpoPushSender::URL
        && $request->hasHeader('Accept', 'application/json')
        && ! $request->hasHeader('Authorization')
        && $request->data() === [
            ['to' => 'ExponentPushToken[token-1]', ...expoSenderMessage()],
            ['to' => 'ExponentPushToken[token-2]', ...expoSenderMessage()],
        ]);
});

it('sends the access token as a bearer when configured', function () {
    config(['workspace.push.expo_access_token' => 'expo-secret']);
    Http::fake([ExpoPushSender::URL => Http::response(['data' => [['status' => 'ok', 'id' => 'a']]])]);

    (new ExpoPushSender)->send(expoSenderTokens(1), expoSenderMessage());

    Http::assertSent(fn (Request $request) => $request->hasHeader('Authorization', 'Bearer expo-secret'));
});

it('accepts a single ticket object instead of an array', function () {
    Http::fake([ExpoPushSender::URL => Http::response(['data' => ['status' => 'ok', 'id' => 'a']])]);

    expect((new ExpoPushSender)->send(expoSenderTokens(1), expoSenderMessage()))->toBe([1 => PushSender::SENT]);
});

it('maps each ticket error to its outcome', function () {
    Log::spy();
    Http::fake([ExpoPushSender::URL => Http::response(['data' => [
        ['status' => 'error', 'message' => 'not registered', 'details' => ['error' => 'DeviceNotRegistered']],
        ['status' => 'error', 'message' => 'too often', 'details' => ['error' => 'MessageRateExceeded']],
        ['status' => 'error', 'message' => 'too big', 'details' => ['error' => 'MessageTooBig']],
        ['status' => 'ok', 'id' => 'd'],
    ]])]);

    $results = (new ExpoPushSender)->send(expoSenderTokens(5), expoSenderMessage());

    expect($results)->toBe([
        1 => PushSender::EXPIRED,
        2 => PushSender::FAILED,
        3 => PushSender::REJECTED,
        4 => PushSender::SENT,
        5 => PushSender::FAILED,
    ]);
    Log::shouldHaveReceived('warning')->with('Expo push ticket rejected.', ['error' => 'MessageTooBig'])->once();
    Log::shouldHaveReceived('warning')->with('Expo push response without a ticket for a message.')->once();
});

it('rejects a ticket with a sender id mismatch', function () {
    Log::spy();
    Http::fake([ExpoPushSender::URL => Http::response(['data' => [
        ['status' => 'error', 'message' => 'wrong credentials', 'details' => ['error' => 'MismatchSenderId']],
    ]])]);

    expect((new ExpoPushSender)->send(expoSenderTokens(1), expoSenderMessage()))->toBe([1 => PushSender::REJECTED]);
    Log::shouldHaveReceived('warning')->with('Expo push ticket rejected.', ['error' => 'MismatchSenderId'])->once();
});

it('marks the whole batch as failed on a 5xx or 429 so it can be retried', function (int $status) {
    Log::spy();
    Http::fake([ExpoPushSender::URL => Http::response(['errors' => [['code' => 'TOO_MANY_REQUESTS', 'message' => 'x']]], $status)]);

    $results = (new ExpoPushSender)->send(expoSenderTokens(2), expoSenderMessage());

    expect($results)->toBe([1 => PushSender::FAILED, 2 => PushSender::FAILED]);
    Log::shouldHaveReceived('warning')->with('Expo push request failed.', [
        'status' => $status,
        'errors' => ['TOO_MANY_REQUESTS'],
    ])->once();
})->with([500, 503, 429]);

it('marks the whole batch as rejected on another 4xx', function () {
    Log::spy();
    Http::fake([ExpoPushSender::URL => Http::response(['errors' => [['code' => 'UNAUTHORIZED', 'message' => 'x']]], 401)]);

    expect((new ExpoPushSender)->send(expoSenderTokens(2), expoSenderMessage()))
        ->toBe([1 => PushSender::REJECTED, 2 => PushSender::REJECTED]);
});

it('marks the whole batch as failed on a network error', function () {
    Log::spy();
    Http::fake([ExpoPushSender::URL => fn () => throw new ConnectionException('timed out')]);

    expect((new ExpoPushSender)->send(expoSenderTokens(2), expoSenderMessage()))
        ->toBe([1 => PushSender::FAILED, 2 => PushSender::FAILED]);
});

it('splits the tokens in batches of at most 100 and keeps each outcome on its token', function () {
    Http::fake([ExpoPushSender::URL => function (Request $request) {
        return Http::response(['data' => array_map(
            fn (array $item) => $item['to'] === 'ExponentPushToken[token-101]'
                ? ['status' => 'error', 'details' => ['error' => 'DeviceNotRegistered']]
                : ['status' => 'ok', 'id' => $item['to']],
            $request->data(),
        )]);
    }]);

    $results = (new ExpoPushSender)->send(expoSenderTokens(205), expoSenderMessage());

    Http::assertSentCount(3);
    $sizes = Http::recorded()->map(fn (array $pair) => count($pair[0]->data()))->all();
    expect($sizes)->toBe([100, 100, 5])
        ->and($results)->toHaveCount(205)
        ->and($results[101])->toBe(PushSender::EXPIRED)
        ->and($results[100])->toBe(PushSender::SENT)
        ->and($results[205])->toBe(PushSender::SENT);
});
