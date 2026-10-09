<?php

use App\Enums\Role;
use App\Events\MembershipRevoked;
use App\Events\MembershipRoleChanged;
use App\Exceptions\LastOwnerException;
use App\Jobs\TerminateUserConnections;
use App\Models\Organization;
use App\Models\User;
use App\Realtime\ConnectionTerminator;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    Event::fake([MembershipRevoked::class, MembershipRoleChanged::class]);
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

it('broadcasts the new role to the affected user private channel when it changes', function () {
    $this->organization->changeMemberRole($this->member, Role::Admin);

    Event::assertDispatchedTimes(MembershipRoleChanged::class, 1);
    Event::assertDispatched(MembershipRoleChanged::class, function (MembershipRoleChanged $event) {
        return $event->broadcastOn()->name === "private-users.{$this->member->id}"
            && $event->broadcastAs() === 'membership.role_changed'
            && $event->broadcastWith() === ['organization_id' => $this->organization->id, 'role' => 'admin'];
    });
});

it('does not broadcast a role change when it would demote the last owner', function () {
    expect(fn () => $this->organization->changeMemberRole($this->owner, Role::Member))
        ->toThrow(LastOwnerException::class);

    Event::assertNotDispatched(MembershipRoleChanged::class);
});

it('does not broadcast a role change when the user is not a member', function () {
    expect(fn () => $this->organization->changeMemberRole(User::factory()->create(), Role::Admin))
        ->toThrow(ModelNotFoundException::class);

    Event::assertNotDispatched(MembershipRoleChanged::class);
});

it('does not broadcast a role change when the surrounding transaction rolls back', function () {
    try {
        DB::transaction(function () {
            $this->organization->changeMemberRole($this->member, Role::Admin);
            throw new RuntimeException('rollback');
        });
    } catch (RuntimeException) {
    }

    Event::assertNotDispatched(MembershipRoleChanged::class);
});

it('does not broadcast a role change when a member is removed', function () {
    $this->organization->removeMember($this->member);

    Event::assertNotDispatched(MembershipRoleChanged::class);
});

it('queues a delayed connection cut for the removed user', function () {
    Queue::fake();

    $this->organization->removeMember($this->member);

    Queue::assertPushed(TerminateUserConnections::class, 1);
    Queue::assertPushed(
        TerminateUserConnections::class,
        fn (TerminateUserConnections $job) => $job->userId === $this->member->id && $job->delay === 5,
    );
});

it('queues the connection cut when a member leaves through the API', function () {
    Queue::fake();
    Sanctum::actingAs($this->member);

    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->deleteJson("/api/members/{$this->member->id}")
        ->assertNoContent();

    Queue::assertPushed(TerminateUserConnections::class, fn ($job) => $job->userId === $this->member->id);
});

it('does not queue the connection cut when the removal fails or rolls back', function () {
    Queue::fake();

    expect(fn () => $this->organization->removeMember($this->owner))->toThrow(LastOwnerException::class);
    expect(fn () => $this->organization->removeMember(User::factory()->create()))
        ->toThrow(ModelNotFoundException::class);

    try {
        DB::transaction(function () {
            $this->organization->removeMember($this->member);
            throw new RuntimeException('rollback');
        });
    } catch (RuntimeException) {
    }

    Queue::assertNothingPushed();
});

it('does not queue the connection cut when the role changes', function () {
    Queue::fake();

    $this->organization->changeMemberRole($this->member, Role::Admin);

    Queue::assertNothingPushed();
});

it('does not fail the removal when queueing the cut fails', function () {
    Queue::shouldReceive('push', 'later')->andThrow(new RuntimeException('queue down'));
    Queue::makePartial();

    $this->organization->removeMember($this->member);

    expect($this->organization->users()->whereKey($this->member->id)->exists())->toBeFalse();
});

it('has the job ask the terminator to close the user connections and retry with backoff', function () {
    $terminator = Mockery::mock(ConnectionTerminator::class);
    $terminator->shouldReceive('terminate')->once()->with(43);

    (new TerminateUserConnections(43))->handle($terminator);

    expect((new TerminateUserConnections(43))->tries)->toBeGreaterThan(1)
        ->and((new TerminateUserConnections(43))->backoff)->not->toBeEmpty();
});
