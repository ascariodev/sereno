<?php

use App\Models\Channel;
use App\Models\LogGroup;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

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

it('rejects a system message with body', function () {
    Message::factory()->for($this->channel)->system()->create(['body' => 'hola']);
})->throws(QueryException::class, 'messages_body_payload_check');

it('rejects a system message without payload', function () {
    Message::factory()->for($this->channel)->system()->create(['payload' => null]);
})->throws(QueryException::class, 'messages_body_payload_check');

function insertSystemMessage(Channel $channel, string $payload): void
{
    DB::table('messages')->insert([
        'organization_id' => $channel->organization_id,
        'channel_id' => $channel->id,
        'kind' => 'system',
        'payload' => $payload,
    ]);
}

it('rejects a system message whose payload is not a JSON object', function (string $payload) {
    insertSystemMessage($this->channel, $payload);
})->with([
    'json null' => 'null',
    'array' => '[1, 2]',
    'string' => '"text"',
    'number' => '42',
])->throws(QueryException::class, 'messages_body_payload_check');

it('accepts a system message whose payload is a JSON object', function () {
    insertSystemMessage($this->channel, '{"type": "log.group_opened"}');

    expect(Message::where('kind', 'system')->count())->toBe(1);
});

it('rejects a person message without body', function () {
    Message::factory()->for($this->channel)->create(['body' => null]);
})->throws(QueryException::class, 'messages_body_payload_check');

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

it('rejects a reply whose parent belongs to another channel', function () {
    $otherChannel = Channel::factory()->for(Project::factory()->for($this->organization)->create())->create();
    $root = Message::factory()->for($otherChannel)->create();

    $reply = Message::factory()->for($this->channel)->make();
    $reply->parent_id = $root->id;

    expect(fn () => $reply->save())->toThrow(QueryException::class);
});

it('deletes replies with their root and with the channel', function () {
    $root = Message::factory()->for($this->channel)->create();
    $reply = Message::factory()->for($this->channel)->make();
    $reply->parent_id = $root->id;
    $reply->save();

    expect($reply->parent->is($root))->toBeTrue()
        ->and($root->replies()->count())->toBe(1);

    $this->channel->delete();

    expect(Message::query()->whereIn('id', [$root->id, $reply->id])->count())->toBe(0);
});

it('deletes replies when the root is deleted', function () {
    $root = Message::factory()->for($this->channel)->create();
    $reply = Message::factory()->for($this->channel)->make();
    $reply->parent_id = $root->id;
    $reply->save();

    $root->delete();

    expect(Message::query()->whereKey($reply->id)->exists())->toBeFalse();
});
