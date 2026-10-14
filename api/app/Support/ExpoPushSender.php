<?php

namespace App\Support;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/** Expo Push Service: https://docs.expo.dev/push-notifications/sending-notifications/ */
class ExpoPushSender implements MobilePushSender
{
    public const URL = 'https://exp.host/--/api/v2/push/send';

    public const BATCH_SIZE = 100;

    private const TIMEOUT_SECONDS = 15;

    public function send(iterable $tokens, array $message): array
    {
        $results = [];

        foreach (collect($tokens)->chunk(self::BATCH_SIZE) as $batch) {
            $batch = $batch->values();
            $outcomes = $this->sendBatch($batch->map(fn ($token) => ['to' => $token->token, ...$message])->all());

            foreach ($batch as $index => $token) {
                $results[$token->id] = $outcomes[$index];
            }
        }

        return $results;
    }

    /**
     * @param  list<array<string, mixed>>  $messages
     * @return list<string> one outcome per message, in order
     */
    private function sendBatch(array $messages): array
    {
        $count = count($messages);

        try {
            $response = Http::acceptJson()
                ->asJson()
                ->timeout(self::TIMEOUT_SECONDS)
                ->when(filled($accessToken = config('workspace.push.expo_access_token')),
                    fn ($request) => $request->withToken($accessToken))
                ->post(self::URL, $messages);
        } catch (ConnectionException $e) {
            Log::warning('Expo push request could not be sent.', ['exception' => $e->getMessage()]);

            return array_fill(0, $count, PushSender::FAILED);
        }

        if (! $response->successful()) {
            return array_fill(0, $count, $this->requestFailure($response));
        }

        $tickets = $response->json('data');

        if (is_array($tickets) && array_key_exists('status', $tickets)) {
            $tickets = [$tickets];
        }

        $outcomes = [];

        for ($index = 0; $index < $count; $index++) {
            $outcomes[] = $this->ticketOutcome(is_array($tickets) ? ($tickets[$index] ?? null) : null);
        }

        return $outcomes;
    }

    private function requestFailure(Response $response): string
    {
        $status = $response->status();

        Log::warning('Expo push request failed.', [
            'status' => $status,
            'errors' => collect($response->json('errors'))->pluck('code')->filter()->values()->all(),
        ]);

        return $status === 429 || $status >= 500 ? PushSender::FAILED : PushSender::REJECTED;
    }

    private function ticketOutcome(mixed $ticket): string
    {
        if (! is_array($ticket)) {
            Log::warning('Expo push response without a ticket for a message.');

            return PushSender::REJECTED;
        }

        if (($ticket['status'] ?? null) === 'ok') {
            return PushSender::SENT;
        }

        $error = $ticket['details']['error'] ?? null;

        return match ($error) {
            'DeviceNotRegistered' => PushSender::EXPIRED,
            'MessageRateExceeded' => PushSender::FAILED,
            default => $this->rejectedTicket($error),
        };
    }

    private function rejectedTicket(mixed $error): string
    {
        Log::warning('Expo push ticket rejected.', ['error' => is_string($error) ? $error : null]);

        return PushSender::REJECTED;
    }
}
