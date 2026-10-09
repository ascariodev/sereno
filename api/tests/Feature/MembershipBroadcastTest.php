<?php

use App\Enums\Role;
use App\Events\MembershipRevoked;
use App\Exceptions\LastOwnerException;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    Event::fake([MembershipRevoked::class]);
    $this->organization = Organization::factory()->create();
    $this->owner = User::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->owner, [Role::Owner]);
    $this->organization->addMember($this->member, [Role::Member]);
});

it('broadcasts membership revoked to the removed user private channel with the organization id', function () {
    $this->organization->removeMember($this->member);

    Event::assertDispatchedTimes(MembershipRevoked::class, 1);
    Event::assertDispatched(MembershipRevoked::class, function (MembershipRevoked $event) {
        return $event->broadcastOn()->name === "private-users.{$this->member->id}"
            && $event->broadcastAs() === 'membership.revoked'
            && $event->broadcastWith() === ['organization_id' => $this->organization->id];
    });
});

it('is broadcast when a member leaves through the API', function () {
    Sanctum::actingAs($this->member);

    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/members/{$this->member->id}")
        ->assertNoContent();

    Event::assertDispatched(MembershipRevoked::class, fn ($e) => $e->userId === $this->member->id);
});

it('is not broadcast when the last owner cannot be removed', function () {
    expect(fn () => $this->organization->removeMember($this->owner))->toThrow(LastOwnerException::class);

    Event::assertNotDispatched(MembershipRevoked::class);
});

it('is not broadcast when the user is not a member', function () {
    $stranger = User::factory()->create();

    expect(fn () => $this->organization->removeMember($stranger))
        ->toThrow(ModelNotFoundException::class);

    Event::assertNotDispatched(MembershipRevoked::class);
});

it('is not broadcast when the surrounding transaction rolls back', function () {
    Event::fake([MembershipRevoked::class]);

    try {
        DB::transaction(function () {
            $this->organization->removeMember($this->member);
            throw new RuntimeException('rollback');
        });
    } catch (RuntimeException) {
    }

    Event::assertNotDispatched(MembershipRevoked::class);
});

it('is not broadcast when the role changes', function () {
    $this->organization->changeMemberRole($this->member, Role::Admin);

    Event::assertNotDispatched(MembershipRevoked::class);
});
