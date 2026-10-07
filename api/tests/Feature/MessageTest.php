<?php

use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create();
});

it('stores a person message with body and fills the organization', function () {
    $user = User::factory()->create();

    $message = Message::factory()->for($this->channel)->create(['user_id' => $user->id, 'body' => 'hola']);
    $message->refresh();

    expect($message->organization_id)->toBe($this->organization->id)
        ->and($message->kind)->toBe('user')
        ->and($message->body)->toBe('hola')
        ->and($message->user->is($user))->toBeTrue()
        ->and($message->created_at)->not->toBeNull();
});

it('stores a system message with payload and no text', function () {
    $group = LogGroup::factory()->for($this->project)->create();

    $message = Message::factory()->for($this->channel)->system(['type' => 'log.group_opened', 'level' => 'error'])
        ->create(['log_group_id' => $group->id]);
    $message->refresh();

    expect($message->kind)->toBe('system')
        ->and($message->body)->toBeNull()
        ->and($message->user_id)->toBeNull()
        ->and($message->payload)->toBe(['type' => 'log.group_opened', 'level' => 'error'])
        ->and($message->logGroup->is($group))->toBeTrue();
});

it('rejects an unknown kind', function () {
    Message::factory()->for($this->channel)->create(['kind' => 'bot']);
})->throws(QueryException::class);

it('keeps the message when the user is deleted', function () {
    $user = User::factory()->create();
    $message = Message::factory()->for($this->channel)->create(['user_id' => $user->id]);

    $user->delete();

    expect($message->fresh()->user_id)->toBeNull();
});

it('keeps the message when the log group is deleted', function () {
    $group = LogGroup::factory()->for($this->project)->create();
    $message = Message::factory()->for($this->channel)->system()->create(['log_group_id' => $group->id]);

    $group->delete();

    expect($message->fresh()->log_group_id)->toBeNull();
});

it('deletes messages with their channel', function () {
    $message = Message::factory()->for($this->channel)->create();

    $this->channel->delete();

    expect(Message::query()->whereKey($message->id)->exists())->toBeFalse();
});

it('isolates messages by organization', function () {
    $message = Message::factory()->for($this->channel)->create();

    app(CurrentOrganization::class)->set($this->other);

    expect(Message::query()->count())->toBe(0)
        ->and(Message::query()->find($message->id))->toBeNull();

    app(CurrentOrganization::class)->set($this->organization);

    expect(Message::query()->count())->toBe(1);
});
