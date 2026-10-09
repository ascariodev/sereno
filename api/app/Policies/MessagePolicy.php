<?php

namespace App\Policies;

use App\Models\Message;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\Gate;

/**
 * Only the author of a live user message may change it, inside the active organization
 * and on a channel they can see. Moderation by owners and admins is not covered.
 */
class MessagePolicy
{
    public function update(User $user, Message $message): bool
    {
        return $this->isAuthorOfLiveMessage($user, $message);
    }

    public function delete(User $user, Message $message): bool
    {
        return $this->isAuthorOfLiveMessage($user, $message);
    }

    private function isAuthorOfLiveMessage(User $user, Message $message): bool
    {
        $activeId = app(CurrentOrganization::class)->id();

        return $activeId !== null
            && $message->organization_id === $activeId
            && $message->kind === Message::KIND_USER
            && $message->user_id === $user->id
            && $message->deleted_at === null
            && Gate::forUser($user)->allows('view', $message->channel);
    }
}
