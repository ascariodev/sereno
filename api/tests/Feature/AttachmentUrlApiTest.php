<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    RateLimiter::clear('attachment-urls');

    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->author = User::factory()->create();
    $this->ana = User::factory()->create();
    $this->organization->addMember($this->author, [Role::Member]);
    $this->organization->addMember($this->ana, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->message = Message::withoutEvents(fn () => Message::factory()->for($this->channel)->for($this->author)->create());

    assignMembersToAllProjects();
});

function urlAttachment(object $test, Organization $organization, Channel $channel, ?Message $message): MessageAttachment
{
    $id = DB::table('message_attachments')->insertGetId([
        'organization_id' => $organization->id,
        'channel_id' => $channel->id,
        'message_id' => $message?->id,
        'uploaded_by' => $test->author->id,
        'disk' => 'local',
        'path' => 'chat/'.$organization->id.'/'.$channel->id.'/'.fake()->regexify('[A-Za-z0-9]{40}'),
        'original_name' => 'notes.txt',
        'mime' => 'text/plain',
        'size' => 5,
    ]);

    return MessageAttachment::withoutGlobalScopes()->findOrFail($id);
}

function requestingUrl(User $user, Organization $organization, MessageAttachment $attachment)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id)
        ->getJson("/api/attachments/{$attachment->id}/url");
}

it('returns a fresh signed url and its expiry to a member with access', function () {
    $attachment = urlAttachment($this, $this->organization, $this->channel, $this->message);

    $response = requestingUrl($this->ana, $this->organization, $attachment)->assertOk();

    $url = $response->json('data.url');
    expect($url)->toStartWith(rtrim(config('app.url'), '/')."/api/attachments/{$attachment->id}?expires=")
        ->toContain('&signature=');

    parse_str(parse_url($url, PHP_URL_QUERY), $query);
    expect(strtotime($response->json('data.expires_at')))->toBe((int) $query['expires']);
});

it('answers 404 to a member without the project', function () {
    $hidden = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $message = Message::withoutEvents(fn () => Message::factory()->for($hidden)->for($this->author)->create());
    $attachment = urlAttachment($this, $this->organization, $hidden, $message);

    requestingUrl($this->ana, $this->organization, $attachment)->assertNotFound();
});

it('answers 404 to an attachment of another organization', function () {
    $channel = Channel::factory()->for(Project::factory()->for($this->other))->create();
    $message = Message::withoutEvents(fn () => Message::factory()->for($channel)->for($this->author)->create());
    $attachment = urlAttachment($this, $this->other, $channel, $message);

    requestingUrl($this->ana, $this->organization, $attachment)->assertNotFound();
});

it('answers 404 to an orphan attachment', function () {
    $attachment = urlAttachment($this, $this->organization, $this->channel, null);

    requestingUrl($this->ana, $this->organization, $attachment)->assertNotFound();
});

it('answers 404 when the message was deleted', function () {
    $attachment = urlAttachment($this, $this->organization, $this->channel, $this->message);
    DB::table('messages')->where('id', $this->message->id)->update(['deleted_at' => now()]);

    requestingUrl($this->ana, $this->organization, $attachment)->assertNotFound();
});

it('translates the 404 message according to Accept-Language', function () {
    $attachment = urlAttachment($this, $this->organization, $this->channel, null);

    test()->withHeader('Accept-Language', 'es');
    requestingUrl($this->ana, $this->organization, $attachment)
        ->assertNotFound()
        ->assertJsonPath('message', 'Recurso no encontrado.');

    test()->withHeader('Accept-Language', 'en');
    requestingUrl($this->ana, $this->organization, $attachment)
        ->assertNotFound()
        ->assertJsonPath('message', 'Resource not found.');
});

it('answers every 404 with the same body as a nonexistent attachment', function () {
    $hidden = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $hiddenMessage = Message::withoutEvents(fn () => Message::factory()->for($hidden)->for($this->author)->create());
    $foreignChannel = Channel::factory()->for(Project::factory()->for($this->other))->create();
    $foreignMessage = Message::withoutEvents(fn () => Message::factory()->for($foreignChannel)->for($this->author)->create());
    $deleted = urlAttachment($this, $this->organization, $this->channel, $this->message);
    DB::table('messages')->where('id', $this->message->id)->update(['deleted_at' => now()]);

    $missing = new MessageAttachment;
    $missing->id = (int) DB::table('message_attachments')->max('id') + 1000;

    $bodies = [
        requestingUrl($this->ana, $this->organization, urlAttachment($this, $this->organization, $hidden, $hiddenMessage))->assertNotFound()->getContent(),
        requestingUrl($this->ana, $this->organization, urlAttachment($this, $this->other, $foreignChannel, $foreignMessage))->assertNotFound()->getContent(),
        requestingUrl($this->ana, $this->organization, urlAttachment($this, $this->organization, $this->channel, null))->assertNotFound()->getContent(),
        requestingUrl($this->ana, $this->organization, $deleted)->assertNotFound()->getContent(),
    ];
    $nonexistent = requestingUrl($this->ana, $this->organization, $missing)->assertNotFound()->getContent();

    expect(json_decode($nonexistent, true))->not->toBeEmpty();
    foreach ($bodies as $body) {
        expect(json_decode($body, true))->toBe(json_decode($nonexistent, true));
    }
});

it('answers 403 with an organization the user does not belong to', function () {
    $attachment = urlAttachment($this, $this->organization, $this->channel, $this->message);

    requestingUrl($this->ana, $this->other, $attachment)->assertForbidden();
});

it('answers 401 without a token', function () {
    $attachment = urlAttachment($this, $this->organization, $this->channel, $this->message);

    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->getJson("/api/attachments/{$attachment->id}/url")
        ->assertUnauthorized();
});

it('throttles per user with a translated 429 and does not affect other users', function () {
    $attachment = urlAttachment($this, $this->organization, $this->channel, $this->message);

    for ($i = 0; $i < AppServiceProvider::ATTACHMENT_URLS_PER_MINUTE; $i++) {
        requestingUrl($this->ana, $this->organization, $attachment)->assertOk();
    }

    requestingUrl($this->ana, $this->organization, $attachment)
        ->assertStatus(429)
        ->assertHeader('Retry-After');

    requestingUrl($this->author, $this->organization, $attachment)->assertOk();
});
