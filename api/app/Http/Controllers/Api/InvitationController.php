<?php

namespace App\Http\Controllers\Api;

use App\Enums\Locale;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Http\Requests\Invitation\InviteRequest;
use App\Models\Invitation;
use App\Notifications\InvitationNotification;
use App\Support\CurrentOrganization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Notification;

class InvitationController extends Controller
{
    public function store(InviteRequest $request): JsonResponse
    {
        $role = Role::from($request->validated('role'));

        $organization = app(CurrentOrganization::class)->get();
        $email = $request->validated('email');
        $locale = Locale::tryFrom($organization->settings['default_locale'] ?? '') ?? Locale::default();
        $plainToken = Invitation::newPlainToken();

        $invitation = DB::transaction(function () use ($request, $email, $role, $locale, $plainToken) {
            // A new invitation invalidates earlier pending ones for the same email,
            // unless one carries a role the inviter could not grant (an admin replacing an owner invite).
            $pending = Invitation::query()->pending()->where('email', $email)->lockForUpdate()->get();

            $outranksInviter = $pending->contains(
                fn (Invitation $pendingInvitation) => Gate::denies('create', [Invitation::class, Role::tryFrom($pendingInvitation->role)]),
            );

            if ($outranksInviter) {
                abort(403, __('A pending invitation for this email has a role you cannot assign.'));
            }

            Invitation::query()->whereKey($pending->modelKeys())->delete();

            return Invitation::create([
                'email' => $email,
                'role' => $role->value,
                'token' => Invitation::hashToken($plainToken),
                'locale' => $locale->value,
                'invited_by' => $request->user()->id,
                'expires_at' => now()->addDays(Invitation::VALID_DAYS),
            ]);
        });

        Notification::route('mail', $email)->notify(
            (new InvitationNotification($organization->name, $role->value, $plainToken))->locale($locale->value),
        );

        return response()->json(['data' => [
            'id' => $invitation->id,
            'email' => $invitation->email,
            'role' => $invitation->role,
            'locale' => $invitation->locale,
            'expires_at' => $invitation->expires_at,
        ]], 201);
    }

    /**
     * Public preview for the invitation link. Every unusable case answers the same 404 so the
     * endpoint does not reveal whether a token existed, was used or expired.
     */
    public function show(string $token): JsonResponse
    {
        $invitation = Invitation::findByPlainToken($token);

        if ($invitation === null || ! $invitation->isUsable() || ! $invitation->inviterCanStillGrantRole()) {
            abort(404, __('The invitation is invalid or has expired.'));
        }

        return response()->json(['data' => [
            'organization' => ['name' => $invitation->organization->name],
            'email' => $invitation->email,
            'role' => $invitation->role,
            'expires_at' => $invitation->expires_at,
        ]]);
    }

    public function accept(Request $request): JsonResponse
    {
        $plainToken = $request->validate(['token' => ['required', 'string']])['token'];
        $user = $request->user();

        $organizationId = DB::transaction(function () use ($plainToken, $user) {
            $invitation = Invitation::findByPlainToken($plainToken, lock: true);

            if ($invitation === null || ! $invitation->isUsable() || ! $invitation->inviterCanStillGrantRole()) {
                abort(422, __('The invitation is invalid or has expired.'));
            }

            if (mb_strtolower($user->email) !== mb_strtolower($invitation->email)) {
                abort(403, __('This invitation was issued for a different email address.'));
            }

            $invitation->organization->addMember($user, [Role::from($invitation->role)]);
            $invitation->forceFill(['accepted_at' => now()])->save();

            return $invitation->organization_id;
        });

        return response()->json(['data' => ['organization_id' => $organizationId]]);
    }
}
