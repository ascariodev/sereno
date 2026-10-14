<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Push\DestroyExpoPushTokenRequest;
use App\Http\Requests\Push\StoreExpoPushTokenRequest;
use App\Models\ExpoPushToken;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Laravel\Sanctum\PersonalAccessToken;

class ExpoPushTokenController extends Controller
{
    public function store(StoreExpoPushTokenRequest $request): JsonResponse
    {
        $accessToken = $request->user()->currentAccessToken();

        abort_unless($accessToken instanceof PersonalAccessToken, 403, __('This action is unauthorized.'));

        $data = $request->safe()->except('token');
        $token = $request->validated('token');

        try {
            [$record, $created] = $this->upsert($token, $data, $request->user()->id, $accessToken->id);
        } catch (UniqueConstraintViolationException) {
            [$record, $created] = $this->upsert($token, $data, $request->user()->id, $accessToken->id);
        }

        return response()->json(['data' => [
            'id' => $record->id,
            'token' => $record->token,
            'platform' => $record->platform,
            'device_name' => $record->device_name,
        ]], $created ? 201 : 200);
    }

    /**
     * @return array{0: ExpoPushToken, 1: bool}
     */
    private function upsert(string $token, array $data, int $userId, int $accessTokenId): array
    {
        $record = ExpoPushToken::firstOrNew(['token' => $token]);
        $record->fill($data);
        $record->user_id = $userId;
        $record->personal_access_token_id = $accessTokenId;
        $record->last_used_at = now();
        $created = ! $record->exists;
        $record->save();

        return [$record, $created];
    }

    public function destroy(DestroyExpoPushTokenRequest $request): Response
    {
        $request->user()->expoPushTokens()->where('token', $request->input('token'))->delete();

        return response()->noContent();
    }
}
