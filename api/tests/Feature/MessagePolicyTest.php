<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\Gate;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();

    $this->users = [];
    foreach (Role::cases() as $role) {
        $user = User::factory()->create();
        $this->organization->addMember($user, [$role]);
        $this->users[$role->value] = $user;
    }

    app(CurrentOrganization::class)->set($this->organization);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->message = Message::factory()->for($this->channel)->create(['user_id' => $this->users['member']->id]);
});

it('lets the author update and delete their message', function () {
    $author = $this->users['member'];

    expect(Gate::forUser($author)->allows('update', $this->message))->toBeTrue()
        ->and(Gate::forUser($author)->allows('delete', $this->message))->toBeTrue();
});

it('denies other members, admins and owners', function (string $role) {
    $user = $this->users[$role];
    if ($role === 'member') {
        $user = User::factory()->create();
        $this->organization->addMember($user, [Role::Member]);
    }

    expect(Gate::forUser($user)->allows('update', $this->message))->toBeFalse()
        ->and(Gate::forUser($user)->allows('delete', $this->message))->toBeFalse();
})->with(['member', 'admin', 'owner']);

it('denies a user from another organization', function () {
    $outsider = User::factory()->create();
    $this->other->addMember($outsider, [Role::Owner]);

    expect(Gate::forUser($outsider)->allows('update', $this->message))->toBeFalse()
        ->and(Gate::forUser($outsider)->allows('delete', $this->message))->toBeFalse();
});

it('denies the author when the message belongs to another organization', function () {
    $author = $this->users['member'];
    $foreignChannel = Channel::factory()->for(Project::factory()->for($this->other))->create();
    $foreign = Message::factory()->for($foreignChannel)->create(['user_id' => $author->id]);

    expect(Gate::forUser($author)->allows('update', $foreign))->toBeFalse()
        ->and(Gate::forUser($author)->allows('delete', $foreign))->toBeFalse();
});

it('denies system notices', function () {
    $notice = Message::factory()->system()->for($this->channel)->create();

    foreach ($this->users as $user) {
        expect(Gate::forUser($user)->allows('update', $notice))->toBeFalse()
            ->and(Gate::forUser($user)->allows('delete', $notice))->toBeFalse();
    }
});

it('denies a deleted message even to its author', function () {
    $author = $this->users['member'];
    $this->message->deleted_at = now();
    $this->message->save();

    expect(Gate::forUser($author)->allows('update', $this->message))->toBeFalse()
        ->and(Gate::forUser($author)->allows('delete', $this->message))->toBeFalse();
});
