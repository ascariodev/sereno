<?php

namespace App\Notifications;

use App\Models\Invitation;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class InvitationNotification extends Notification implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $organizationName,
        public readonly string $role,
        public readonly string $plainToken,
    ) {}

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject(__('You have been invited to :organization', ['organization' => $this->organizationName]))
            ->line(__('You have been invited to join :organization as :role.', [
                'organization' => $this->organizationName,
                'role' => __($this->role),
            ]))
            ->line(__('Your invitation token is: :token', ['token' => $this->plainToken]))
            ->line(__('This invitation expires in :days days.', ['days' => Invitation::VALID_DAYS]));
    }
}
