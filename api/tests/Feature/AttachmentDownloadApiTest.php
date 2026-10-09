<?php

use App\Enums\Role;
use App\Events\MentionCreated;
use App\Events\MessageCreated;
use App\Http\Resources\MessageAttachmentResource;
use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Providers\AppServiceProvider;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpFoundation\StreamedResponse;

const DOWNLOAD_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeEach(function () {
    Storage::fake('local');
    config(['chat.attachments.disk' => 'local']);

    $this->organization = Organization::factory()->create();
    $this->author = User::factory()->create();
    $this->ana = User::factory()->create();
    $this->organization->addMember($this->author, [Role::Member]);
    $this->organization->addMember($this->ana, [Role::Member]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->message = Message::withoutEvents(fn () => Message::factory()->for($this->channel)->for($this->author)->create());
});

function downloadableAttachment(object $test, array $attributes = [], ?string $content = 'hello world', bool $linked = true): MessageAttachment
{
    $path = 'chat/'.$test->organization->id.'/'.$test->channel->id.'/'.fake()->regexify('[A-Za-z0-9]{40}');

    if ($content !== null) {
        Storage::disk('local')->put($path, $content);
    }

    $id = DB::table('message_attachments')->insertGetId([
        'organization_id' => $test->organization->id,
        'channel_id' => $test->channel->id,
        'message_id' => $linked ? $test->message->id : null,
        'uploaded_by' => $test->author->id,
        'disk' => 'local',
        'path' => $path,
        'original_name' => 'notes.txt',
        'mime' => 'text/plain',
        'size' => strlen((string) $content),
        ...$attributes,
    ]);

    return MessageAttachment::withoutGlobalScopes()->findOrFail($id);
}

// Without Bearer, X-Organization-Id nor active tenant, like an <img> in the browser.
function fetchAttachment(string $url, array $server = []): TestResponse
{
    app(CurrentOrganization::class)->set(null);
    app('auth')->forgetGuards();

    return test()->flushHeaders()->withServerVariables($server)->get($url);
}

it('puts a signed url on APP_URL in the resource that downloads without bearer nor organization', function () {
    $attachment = downloadableAttachment($this);
    $url = (new MessageAttachmentResource($attachment))->resolve()['url'];

    expect($url)->toStartWith(rtrim(config('app.url'), '/')."/api/attachments/{$attachment->id}?expires=")
        ->toContain('&signature=');

    $response = fetchAttachment($url)->assertOk();

    expect($response->baseResponse)->toBeInstanceOf(StreamedResponse::class)
        ->and($response->streamedContent())->toBe('hello world')
        ->and($response->headers->get('Content-Length'))->toBe('11');
});

it('generates a valid url without an active organization, as the queue worker does', function () {
    $attachment = downloadableAttachment($this);
    app(CurrentOrganization::class)->set(null);

    fetchAttachment((new MessageAttachmentResource($attachment))->resolve()['url'])->assertOk();
});

it('serves the urls carried by message.created and mention.created', function () {
    Event::fake([MessageCreated::class, MentionCreated::class]);
    $attachment = downloadableAttachment($this, linked: false);
    Sanctum::actingAs($this->author);
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->postJson("/api/channels/{$this->channel->id}/messages", [
            'body' => "<@{$this->ana->id}>",
            'attachment_ids' => [$attachment->id],
        ])
        ->assertCreated();

    $urls = [];
    Event::assertDispatched(MessageCreated::class, function (MessageCreated $event) use (&$urls) {
        $urls[] = $event->broadcastWith()['message']['attachments'][0]['url'];

        return true;
    });
    Event::assertDispatched(MentionCreated::class, function (MentionCreated $event) use (&$urls) {
        $urls[] = $event->broadcastWith()['message']['attachments'][0]['url'];

        return true;
    });

    expect($urls)->toHaveCount(2);
    foreach ($urls as $url) {
        expect(fetchAttachment($url)->assertOk()->streamedContent())->toBe('hello world');
    }
});

function attachmentUrlExpiry(string $url): int
{
    parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

    return (int) $query['expires'];
}

it('keeps the url valid until it expires', function () {
    $this->freezeTime();
    $attachment = downloadableAttachment($this);
    $url = $attachment->downloadUrl();
    $expires = attachmentUrlExpiry($url);

    $this->travelTo(now()->setTimestamp($expires - 1));
    fetchAttachment($url)->assertOk();

    $this->travelTo(now()->setTimestamp($expires + 1));
    fetchAttachment($url)->assertForbidden();
});

it('rounds the expiry up to the next step, never below the ttl', function (int $offset) {
    $step = MessageAttachment::URL_EXPIRY_STEP_SECONDS;
    $this->travelTo(now()->setTimestamp(intdiv(now()->getTimestamp(), $step) * $step + $offset));
    $minimum = now()->getTimestamp() + config('chat.attachments.url_ttl_minutes') * 60;

    $expires = attachmentUrlExpiry(downloadableAttachment($this)->downloadUrl());

    expect($expires % $step)->toBe(0)
        ->and($expires)->toBeGreaterThanOrEqual($minimum)
        ->and($expires - $minimum)->toBeLessThan($step);
})->with(['on a boundary' => 0, 'just after' => 1, 'mid step' => 300, 'just before the next' => 599]);

it('gives the same url within a step and a new one after it', function (?int $ttl) {
    if ($ttl !== null) {
        config(['chat.attachments.url_ttl_minutes' => $ttl]);
    }

    $step = MessageAttachment::URL_EXPIRY_STEP_SECONDS;
    $ttlSeconds = config('chat.attachments.url_ttl_minutes') * 60;
    $boundary = intdiv(now()->getTimestamp() + $ttlSeconds, $step) * $step + $step;
    $start = $boundary - $step - $ttlSeconds + 1;
    $attachment = downloadableAttachment($this);

    $this->travelTo(now()->setTimestamp($start));
    $first = $attachment->downloadUrl();

    $this->travelTo(now()->setTimestamp($start + $step - 1));
    expect($attachment->downloadUrl())->toBe($first);

    $this->travelTo(now()->setTimestamp($start + $step));
    expect($attachment->downloadUrl())->not->toBe($first);
})->with(['default ttl' => null, 'ttl not a multiple of the step' => 15]);

it('caches the file privately only while the url is valid', function () {
    $this->freezeTime();
    $attachment = downloadableAttachment($this);
    $url = $attachment->downloadUrl();
    $this->travel(10)->minutes();

    $cache = fetchAttachment($url)->assertOk()->headers->get('Cache-Control');
    $seconds = attachmentUrlExpiry($url) - now()->getTimestamp();

    expect($seconds)->toBeGreaterThan(0)
        ->and(explode(', ', $cache))->toEqualCanonicalizing(['private', "max-age={$seconds}"]);
});

it('opens the file only when the body is sent and reports it if it is gone', function () {
    Exceptions::fake();
    $attachment = downloadableAttachment($this);

    $response = fetchAttachment($attachment->downloadUrl())->assertOk()->assertHeader('Content-Length', '11');
    Storage::disk('local')->delete($attachment->path);

    expect($response->streamedContent())->toBe('');
    Exceptions::assertReported(RuntimeException::class);
});

it('answers a head request with the length from storage', function () {
    $attachment = downloadableAttachment($this, ['size' => 999]);
    app(CurrentOrganization::class)->set(null);
    app('auth')->forgetGuards();

    $disk = Mockery::mock(Storage::disk('local'));
    $disk->shouldNotReceive('readStream');
    Storage::set('local', $disk);

    $response = $this->flushHeaders()->call('HEAD', $attachment->downloadUrl())
        ->assertOk()
        ->assertHeader('Content-Length', '11');

    expect($response->streamedContent())->toBe('');
});

it('rejects a missing, altered or borrowed signature with a translated 403', function (Closure $tamper) {
    $attachment = downloadableAttachment($this);
    $other = downloadableAttachment($this);

    $response = fetchAttachment($tamper($attachment->downloadUrl(), $attachment, $other), ['HTTP_ACCEPT_LANGUAGE' => 'es'])
        ->assertForbidden();

    expect($response->json('message'))->toBe('El enlace no es válido o ha vencido.');
})->with([
    'unsigned' => fn (string $url, MessageAttachment $a) => "/api/attachments/{$a->id}",
    'altered signature' => fn (string $url) => preg_replace('/signature=(.)/', 'signature=$1$1', $url),
    'extended expiry' => fn (string $url) => preg_replace_callback('/expires=(\d+)/', fn ($m) => 'expires='.($m[1] + 3600), $url),
    'other attachment' => fn (string $url, MessageAttachment $a, MessageAttachment $o) => str_replace("/attachments/{$a->id}?", "/attachments/{$o->id}?", $url),
    'extra query' => fn (string $url) => $url.'&download=1',
]);

it('answers 404 for a signed url of an orphan, deleted or missing file', function (string $case) {
    $attachment = match ($case) {
        'orphan' => downloadableAttachment($this, linked: false),
        'missing file' => downloadableAttachment($this, content: null),
        'deleted row' => downloadableAttachment($this),
    };
    $url = $attachment->downloadUrl();

    if ($case === 'deleted row') {
        DB::table('message_attachments')->where('id', $attachment->id)->delete();
    }

    fetchAttachment($url)->assertNotFound()->assertJsonStructure(['message']);
})->with(['orphan', 'missing file', 'deleted row']);

it('validates the relative signature behind the proxy, whatever host and scheme arrive', function () {
    $attachment = downloadableAttachment($this);
    $path = parse_url($attachment->downloadUrl(), PHP_URL_PATH).'?'.parse_url($attachment->downloadUrl(), PHP_URL_QUERY);

    fetchAttachment('http://api.sereno.test'.$path, [
        'REMOTE_ADDR' => '172.18.0.1',
        'HTTP_X_FORWARDED_PROTO' => 'https',
    ])->assertOk();
});

it('shows only png, jpeg, gif and webp inline with their mime', function (string $mime) {
    $attachment = downloadableAttachment($this, ['mime' => $mime, 'original_name' => 'pic.png'], base64_decode(DOWNLOAD_PNG));

    $response = fetchAttachment($attachment->downloadUrl())->assertOk();

    expect($response->headers->get('Content-Type'))->toBe($mime)
        ->and($response->headers->get('Content-Disposition'))->toBe("inline; filename=\"pic.png\"; filename*=UTF-8''pic.png");
})->with(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

it('downloads everything else, as opaque bytes when the browser could render it', function (string $mime, string $type) {
    $attachment = downloadableAttachment($this, ['mime' => $mime, 'original_name' => 'file.bin']);

    $response = fetchAttachment($attachment->downloadUrl())->assertOk();

    expect($response->headers->get('Content-Type'))->toBe($type)
        ->and($response->headers->get('Content-Disposition'))->toStartWith('attachment; ');
})->with([
    'svg' => ['image/svg+xml', 'application/octet-stream'],
    'html' => ['text/html', 'application/octet-stream'],
    'plain text' => ['text/plain', 'application/octet-stream'],
    'xhtml' => ['application/xhtml+xml', 'application/octet-stream'],
    'javascript' => ['application/javascript', 'application/octet-stream'],
    'malformed' => ["text/plain\r\nX-Evil: 1", 'application/octet-stream'],
    'pdf' => ['application/pdf', 'application/octet-stream'],
    'zip' => ['application/zip', 'application/zip'],
    'bmp' => ['image/bmp', 'image/bmp'],
]);

it('sends the security headers', function (string $mime) {
    $attachment = downloadableAttachment($this, ['mime' => $mime]);

    $headers = fetchAttachment($attachment->downloadUrl())->assertOk()->headers;

    expect($headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($headers->get('Content-Security-Policy'))->toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox")
        ->and($headers->get('Referrer-Policy'))->toBe('no-referrer');
})->with(['image/png', 'text/html']);

it('encodes the original name per RFC 6266 without breaking the header', function () {
    $name = "informe \"final\";\r\nX-Evil: 1 ñandú.pdf";
    $attachment = downloadableAttachment($this, ['mime' => 'application/pdf', 'original_name' => $name]);

    $response = fetchAttachment($attachment->downloadUrl())->assertOk();
    $disposition = $response->headers->get('Content-Disposition');

    expect($disposition)->toBe('attachment; filename="informe _final_ X-Evil_ 1 nandu.pdf"; filename*=UTF-8\'\''.rawurlencode($name))
        ->and($disposition)->not->toMatch('/[\r\n]/')
        ->and($response->headers->has('X-Evil'))->toBeFalse();
});

it('falls back to a generic ascii name', function () {
    $attachment = downloadableAttachment($this, ['mime' => 'application/pdf', 'original_name' => '日本語']);

    expect(fetchAttachment($attachment->downloadUrl())->headers->get('Content-Disposition'))
        ->toStartWith('attachment; filename="');
});

it('throttles downloads per ip', function () {
    $attachment = downloadableAttachment($this);
    $bad = "/api/attachments/{$attachment->id}?expires=1&signature=x";

    for ($i = 0; $i < AppServiceProvider::ATTACHMENT_DOWNLOADS_PER_MINUTE; $i++) {
        fetchAttachment($bad)->assertForbidden();
    }

    fetchAttachment($attachment->downloadUrl())->assertTooManyRequests()->assertHeader('Retry-After');
    fetchAttachment($attachment->downloadUrl(), ['REMOTE_ADDR' => '10.0.0.9'])->assertOk();
});
