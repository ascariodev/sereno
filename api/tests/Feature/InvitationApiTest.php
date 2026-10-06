<?php

use App\Enums\Role;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use App\Notifications\InvitationNotification;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Notifications\SendQueuedNotifications;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->organization = Organization::factory()->create(['settings' => ['default_locale' => 'es']]);
    $this->owner = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
});

function invite(User $inviter, Organization $organization, array $payload)
{
    Sanctum::actingAs($inviter);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)->postJson('/api/invitations', $payload);
}

it('lets an owner invite and sends the email in the organization locale', function () {
    Notification::fake();

    invite($this->owner, $this->organization, ['email' => 'New@Example.com', 'role' => 'admin'])
        ->assertCreated()
        ->assertJsonPath('data.email', 'new@example.com')
        ->assertJsonPath('data.locale', 'es')
        ->assertJsonMissingPath('data.token');

    $invitation = Invitation::query()->firstOrFail();
    expect($invitation->token)->toHaveLength(64)->and($invitation->role)->toBe('admin');

    Notification::assertSentTo(
        new AnonymousNotifiable,
        InvitationNotification::class,
        function (InvitationNotification $notification, array $channels, AnonymousNotifiable $notifiable) use ($invitation) {
            return $notification->locale === 'es'
                && $notifiable->routes['mail'] === 'new@example.com'
                && Invitation::hashToken($notification->plainToken) === $invitation->token;
        },
    );
});

it('renders the invitation email in the invitation locale', function () {
    $notification = (new InvitationNotification('Acme', 'member', 'tok'))->locale('es');

    $previous = App::getLocale();
    App::setLocale($notification->locale);
    $subject = $notification->toMail(new AnonymousNotifiable)->subject;
    App::setLocale($previous);

    expect($subject)->toBe('Te han invitado a Acme');
});

it('lets an admin invite members but not owners', function () {
    Notification::fake();
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);

    invite($admin, $this->organization, ['email' => 'a@example.com', 'role' => 'member'])->assertCreated();
    invite($admin, $this->organization, ['email' => 'b@example.com', 'role' => 'owner'])->assertForbidden();
});

it('forbids plain members from inviting', function () {
    $member = User::factory()->create();
    $this->organization->addMember($member, [Role::Member]);

    invite($member, $this->organization, ['email' => 'a@example.com', 'role' => 'member'])->assertForbidden();
});

it('returns 403, not 422, when a plain member probes an existing member email', function () {
    $member = User::factory()->create();
    $this->organization->addMember($member, [Role::Member]);

    invite($member, $this->organization, ['email' => $this->owner->email, 'role' => 'member'])->assertForbidden();
});

it('returns 403 for an admin inviting an owner even with an existing member email', function () {
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);

    invite($admin, $this->organization, ['email' => $this->owner->email, 'role' => 'owner'])->assertForbidden();
});

it('rejects inviting an existing member', function () {
    Notification::fake();

    invite($this->owner, $this->organization, ['email' => strtoupper($this->owner->email), 'role' => 'member'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('email');
});

it('rejects an invalid role', function () {
    invite($this->owner, $this->organization, ['email' => 'a@example.com', 'role' => 'god'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('role');
});

it('rejects an organization header the user does not belong to', function () {
    $other = Organization::factory()->create();

    invite($this->owner, $other, ['email' => 'a@example.com', 'role' => 'member'])->assertForbidden();
    expect(Invitation::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('invalidates earlier pending invitations for the same email', function () {
    Notification::fake();

    invite($this->owner, $this->organization, ['email' => 'a@example.com', 'role' => 'member'])->assertCreated();
    invite($this->owner, $this->organization, ['email' => 'a@example.com', 'role' => 'admin'])->assertCreated();

    $invitations = Invitation::query()->withoutGlobalScopes()->get();
    expect($invitations)->toHaveCount(1)->and($invitations->first()->role)->toBe('admin');
});

it('forbids an admin from replacing a pending owner invitation', function () {
    Notification::fake();
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);

    invite($this->owner, $this->organization, ['email' => 'a@example.com', 'role' => 'owner'])->assertCreated();

    invite($admin, $this->organization, ['email' => 'A@example.com', 'role' => 'member'])
        ->assertForbidden()
        ->assertJsonPath('message', 'A pending invitation for this email has a role you cannot assign.');

    $invitations = Invitation::query()->withoutGlobalScopes()->get();
    expect($invitations)->toHaveCount(1)->and($invitations->first()->role)->toBe('owner');
});

it('lets an admin replace a pending invitation of a role they can assign', function () {
    Notification::fake();
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);

    invite($this->owner, $this->organization, ['email' => 'a@example.com', 'role' => 'admin'])->assertCreated();
    invite($admin, $this->organization, ['email' => 'a@example.com', 'role' => 'member'])->assertCreated();

    $invitations = Invitation::query()->withoutGlobalScopes()->get();
    expect($invitations)->toHaveCount(1)->and($invitations->first()->role)->toBe('member');
});

it('accepts an invitation, creating the membership with the role', function () {
    $invitee = User::factory()->create(['email' => 'Invitee@Example.com']);
    Invitation::factory()->withPlainToken('plain')->create([
        'organization_id' => $this->organization->id,
        'invited_by' => $this->owner->id,
        'email' => 'invitee@example.com',
        'role' => 'admin',
    ]);
    Sanctum::actingAs($invitee);

    $this->postJson('/api/invitations/accept', ['token' => 'plain'])
        ->assertOk()
        ->assertJsonPath('data.organization_id', $this->organization->id);

    expect($this->organization->users()->whereKey($invitee->id)->exists())->toBeTrue();
    setPermissionsTeamId($this->organization->id);
    expect($invitee->unsetRelation('roles')->hasRole('admin'))->toBeTrue();
    setPermissionsTeamId(null);
    expect(Invitation::query()->withoutGlobalScopes()->firstOrFail()->accepted_at)->not->toBeNull();
});

it('does not accept a used invitation twice', function () {
    $invitee = User::factory()->create();
    Invitation::factory()->withPlainToken('plain')->create([
        'organization_id' => $this->organization->id,
        'invited_by' => $this->owner->id,
        'email' => $invitee->email,
    ]);
    Sanctum::actingAs($invitee);

    $this->postJson('/api/invitations/accept', ['token' => 'plain'])->assertOk();
    $this->postJson('/api/invitations/accept', ['token' => 'plain'])->assertUnprocessable();
});

it('does not accept an expired invitation', function () {
    $invitee = User::factory()->create();
    Invitation::factory()->withPlainToken('plain')->create([
        'organization_id' => $this->organization->id,
        'invited_by' => $this->owner->id,
        'email' => $invitee->email,
        'expires_at' => now()->subMinute(),
    ]);
    Sanctum::actingAs($invitee);

    $this->postJson('/api/invitations/accept', ['token' => 'plain'])->assertUnprocessable();
    expect($this->organization->users()->whereKey($invitee->id)->exists())->toBeFalse();
});

it('does not accept an unknown token', function () {
    Sanctum::actingAs(User::factory()->create());

    $this->postJson('/api/invitations/accept', ['token' => 'nope'])->assertUnprocessable();
});

it('forbids accepting with a different account and leaves the invitation usable', function () {
    Invitation::factory()->withPlainToken('plain')->create([
        'organization_id' => $this->organization->id,
        'invited_by' => $this->owner->id,
        'email' => 'someone@example.com',
    ]);
    $stranger = User::factory()->create();
    Sanctum::actingAs($stranger);

    $this->postJson('/api/invitations/accept', ['token' => 'plain'])->assertForbidden();

    expect(Invitation::query()->withoutGlobalScopes()->firstOrFail()->accepted_at)->toBeNull();
    expect($this->organization->users()->whereKey($stranger->id)->exists())->toBeFalse();
});

it('requires authentication to accept', function () {
    $this->postJson('/api/invitations/accept', ['token' => 'plain'])->assertUnauthorized();
});

function acceptRejectedInvitation(Organization $organization, User $inviter, string $role, ?Closure $beforeAccept = null): void
{
    $invitee = User::factory()->create();
    Invitation::factory()->withPlainToken('plain')->create([
        'organization_id' => $organization->id,
        'email' => $invitee->email,
        'role' => $role,
        'invited_by' => $inviter->id,
    ]);
    $beforeAccept?->__invoke();
    Sanctum::actingAs($invitee);

    test()->postJson('/api/invitations/accept', ['token' => 'plain'])
        ->assertUnprocessable()
        ->assertJsonPath('message', __('The invitation is invalid or has expired.'));

    expect($organization->users()->whereKey($invitee->id)->exists())->toBeFalse()
        ->and(Invitation::query()->withoutGlobalScopes()->firstOrFail()->accepted_at)->toBeNull()
        ->and(getPermissionsTeamId())->toBeNull();
}

it('rejects an invitation whose inviter was demoted below the invited role', function () {
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);

    acceptRejectedInvitation($this->organization, $admin, 'member', function () use ($admin) {
        setPermissionsTeamId($this->organization->id);
        $admin->syncRoles([Role::Member]);
        setPermissionsTeamId(null);
    });
});

it('rejects an invitation whose inviter is no longer a member', function () {
    $formerAdmin = User::factory()->create();
    $this->organization->addMember($formerAdmin, [Role::Admin]);

    acceptRejectedInvitation($this->organization, $formerAdmin, 'member', fn () => $this->organization->users()->detach($formerAdmin->id));
});

it('rejects an invitation whose inviter was deleted', function () {
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);

    acceptRejectedInvitation($this->organization, $admin, 'member', function () use ($admin) {
        $admin->delete();
        expect(Invitation::query()->withoutGlobalScopes()->firstOrFail()->invited_by)->toBeNull();
    });
});

it('rejects an owner invitation issued by an admin', function () {
    $admin = User::factory()->create();
    $this->organization->addMember($admin, [Role::Admin]);

    acceptRejectedInvitation($this->organization, $admin, 'owner');
});

it('queues the invitation email keeping the invitation locale', function () {
    Queue::fake();

    invite($this->owner, $this->organization, ['email' => 'q@example.com', 'role' => 'member'])->assertCreated();

    Queue::assertPushed(SendQueuedNotifications::class, function (SendQueuedNotifications $job) {
        return $job->notification instanceof InvitationNotification
            && $job->notification->locale === 'es'
            && $job->shouldBeEncrypted === true;
    });
});
