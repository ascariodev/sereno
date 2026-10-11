<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Message;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Only the author of a live user message may edit it, inside the active organization and on a
 * channel they can see. Owners and admins may also delete other people's messages (moderation).
 */
class MessagePolicy
{
    public function update(User $user, Message $message): Response|bool
    {
        return $this->isAuthorOfLiveMessage($user, $message);
    }

    public function delete(User $user, Message $message): Response|bool
    {
        return $this->isLiveUserMessage($user, $message, moderator: $user->hasAnyRole([Role::Owner->value, Role::Admin->value]));
    }

    private function isAuthorOfLiveMessage(User $user, Message $message): Response|bool
    {
        return $this->isLiveUserMessage($user, $message, moderator: false);
    }

    private function isLiveUserMessage(User $user, Message $message, bool $moderator): Response|bool
    {
        $activeId = app(CurrentOrganization::class)->id();

        if ($activeId === null
            || $message->organization_id !== $activeId
            || $message->kind !== Message::KIND_USER
            || ($message->user_id !== $user->id && ! $moderator)
            || $message->deleted_at !== null) {
            return false;
        }

        return Gate::forUser($user)->inspect('view', $message->channel);
    }
}
