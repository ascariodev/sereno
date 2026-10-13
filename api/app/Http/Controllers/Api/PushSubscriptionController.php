<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Push\DestroyPushSubscriptionRequest;
use App\Http\Requests\Push\StorePushSubscriptionRequest;
use App\Models\PushSubscription;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class PushSubscriptionController extends Controller
{
    public function vapidPublicKey(): JsonResponse
    {
        $key = config('workspace.push.vapid_public_key');

        abort_if(blank($key), 503, __('Push notifications are not configured.'));

        return response()->json(['data' => ['public_key' => $key]]);
    }

    public function store(StorePushSubscriptionRequest $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->safe()->except('endpoint');

        $subscription = PushSubscription::firstOrNew(['endpoint' => $request->validated('endpoint')]);
        $subscription->fill($data);
        $subscription->user_id = $user->id;
        $subscription->last_used_at = now();
        $created = ! $subscription->exists;
        $subscription->save();
        $subscription->refresh();

        return response()->json(['data' => [
            'id' => $subscription->id,
            'endpoint' => $subscription->endpoint,
            'content_encoding' => $subscription->content_encoding,
        ]], $created ? 201 : 200);
    }

    public function destroy(DestroyPushSubscriptionRequest $request): Response
    {
        $request->user()->pushSubscriptions()->where('endpoint', $request->input('endpoint'))->delete();

        return response()->noContent();
    }
}
