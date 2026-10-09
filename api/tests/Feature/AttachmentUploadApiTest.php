<?php

use App\Enums\Role;
use App\Models\Channel;
use App\Models\MessageAttachment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Providers\AppServiceProvider;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

const ATTACHMENT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeEach(function () {
    RateLimiter::clear('chat-attachments');
    Storage::fake('local');
    Storage::fake('public');
    config(['chat.attachments.disk' => 'local']);

    $this->organization = Organization::factory()->create();
    $this->other = Organization::factory()->create();
    $this->member = User::factory()->create();
    $this->organization->addMember($this->member, [Role::Member]);
    $this->admin = User::factory()->create();
    $this->organization->addMember($this->admin, [Role::Admin]);
    $this->outsider = User::factory()->create();
    $this->other->addMember($this->outsider, [Role::Owner]);
    $this->channel = Channel::factory()->for(Project::factory()->for($this->organization))->create();
    $this->url = "/api/channels/{$this->channel->id}/attachments";
});

// A real file on disk, so the MIME is detected from its bytes and not guessed from the client name.
function uploadFixture(string $content, string $clientName = 'notes.txt', string $clientMime = 'text/plain'): UploadedFile
{
    $tmp = tempnam(sys_get_temp_dir(), 'att');
    file_put_contents($tmp, $content);

    return new UploadedFile($tmp, $clientName, $clientMime, null, true);
}

function uploadingAs(User $user, Organization $organization)
{
    Sanctum::actingAs($user);

    return test()->withHeader('X-Organization-Id', (string) $organization->id);
}

function storedAttachmentFiles(): array
{
    return Storage::disk('local')->allFiles();
}

it('stores the file on the private disk and returns the attachment without a message', function () {
    $response = uploadingAs($this->member, $this->organization)
        ->postJson($this->url, [
            'file' => uploadFixture('hello world', 'notes.txt'),
            'message_id' => 1,
            'path' => 'evil',
            'disk' => 'public',
            'organization_id' => $this->other->id,
        ])
        ->assertCreated();

    $attachment = MessageAttachment::withoutGlobalScopes()->sole();

    expect(array_keys($response->json('data')))->toBe(['id', 'original_name', 'mime', 'size', 'created_at', 'url'])
        ->and($response->json('data.id'))->toBe($attachment->id)
        ->and($response->json('data.original_name'))->toBe('notes.txt')
        ->and($response->json('data.mime'))->toBe('text/plain')
        ->and($response->json('data.size'))->toBe(11)
        ->and($response->json('data.created_at'))->not->toBeNull()
        ->and($attachment->organization_id)->toBe($this->organization->id)
        ->and($attachment->channel_id)->toBe($this->channel->id)
        ->and($attachment->message_id)->toBeNull()
        ->and($attachment->uploaded_by)->toBe($this->member->id)
        ->and($attachment->disk)->toBe('local')
        ->and($attachment->path)->toMatch("#^chat/{$this->organization->id}/{$this->channel->id}/[A-Za-z0-9]{40}$#")
        ->and(storedAttachmentFiles())->toBe([$attachment->path])
        ->and(Storage::disk('local')->get($attachment->path))->toBe('hello world');
});

it('builds the path only from server data and sanitizes the original name', function (string $clientName, string $expected) {
    uploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => uploadFixture('data', $clientName)])
        ->assertCreated()
        ->assertJsonPath('data.original_name', $expected);

    $attachment = MessageAttachment::withoutGlobalScopes()->sole();

    expect($attachment->original_name)->toBe($expected)
        ->and($attachment->path)->toMatch("#^chat/{$this->organization->id}/{$this->channel->id}/[A-Za-z0-9]{40}$#")
        ->and(storedAttachmentFiles())->toBe([$attachment->path]);
})->with([
    'parent traversal' => ['../../../etc/passwd', 'passwd'],
    'forward slash' => ['dir/inner.txt', 'inner.txt'],
    'backslash' => ['..\\..\\win.ini', 'win.ini'],
    'nul byte' => ["shell\0.php.txt", 'shell.php.txt'],
    'control characters' => ["a\x07b\x1Bc\u{202E}.txt", 'abc.txt'],
    'invalid utf-8' => ["caf\xC3.txt", 'caf?.txt'],
    'only dots' => ['..', 'file'],
    'empty after cleaning' => ["\0\x01", 'file'],
    'surrounding spaces' => ['  report.pdf  ', 'report.pdf'],
    'too long keeps the extension' => [str_repeat('a', 300).'.txt', str_repeat('a', 251).'.txt'],
    'too long multibyte' => [str_repeat('ñ', 300), str_repeat('ñ', 255)],
    'too long cut before spaces and dots' => [str_repeat('a', 249).' . .'.str_repeat('b', 60).'.txt', str_repeat('a', 249).'.txt'],
]);

it('detects the MIME type from the content, not from the client', function () {
    uploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => uploadFixture('<?php echo 1;', 'photo.png', 'image/png')])
        ->assertCreated();

    uploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => uploadFixture(base64_decode(ATTACHMENT_PNG), 'notes.txt', 'text/plain')])
        ->assertCreated()
        ->assertJsonPath('data.mime', 'image/png');

    $mimes = MessageAttachment::withoutGlobalScopes()->orderBy('id')->pluck('mime')->all();

    expect($mimes[0])->not->toBe('image/png')->toStartWith('text/')
        ->and($mimes[1])->toBe('image/png');
});

it('enforces the configured maximum size', function () {
    config(['chat.attachments.max_size_kb' => 1]);

    uploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => uploadFixture(str_repeat('a', 1025))])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('file');

    expect(storedAttachmentFiles())->toBe([])
        ->and(MessageAttachment::withoutGlobalScopes()->count())->toBe(0);

    uploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => uploadFixture(str_repeat('a', 1024))])
        ->assertCreated()
        ->assertJsonPath('data.size', 1024);
});

it('rejects an empty file with a translated error', function () {
    uploadingAs($this->member, $this->organization)
        ->withHeader('Accept-Language', 'es')
        ->postJson($this->url, ['file' => uploadFixture('')])
        ->assertUnprocessable()
        ->assertJsonPath('errors.file.0', 'El archivo está vacío.');

    expect(storedAttachmentFiles())->toBe([])
        ->and(MessageAttachment::withoutGlobalScopes()->count())->toBe(0);
});

it('requires a file', function (array $payload) {
    uploadingAs($this->member, $this->organization)
        ->postJson($this->url, $payload)
        ->assertUnprocessable()
        ->assertJsonValidationErrors('file');

    expect(MessageAttachment::withoutGlobalScopes()->count())->toBe(0);
})->with([
    'missing' => [[]],
    'string' => [['file' => 'not a file']],
    'array' => [['file' => ['x']]],
]);

it('rejects uploads to an archived channel with a translated error', function () {
    $archived = Channel::factory()->for(Project::factory()->for($this->organization))->archived()->create();

    uploadingAs($this->member, $this->organization)
        ->withHeader('Accept-Language', 'es')
        ->postJson("/api/channels/{$archived->id}/attachments", ['file' => uploadFixture('x')])
        ->assertUnprocessable()
        ->assertJsonPath('errors.channel.0', 'El canal está archivado.');

    expect(storedAttachmentFiles())->toBe([])
        ->and(MessageAttachment::withoutGlobalScopes()->count())->toBe(0);
});

it('hides channels of other organizations and requires membership before validating', function (array $payload) {
    uploadingAs($this->outsider, $this->other)
        ->postJson($this->url, $payload)
        ->assertNotFound();

    uploadingAs($this->outsider, $this->organization)
        ->postJson($this->url, $payload)
        ->assertForbidden();

    expect(storedAttachmentFiles())->toBe([])
        ->and(MessageAttachment::withoutGlobalScopes()->count())->toBe(0);
})->with([
    'valid file' => [fn () => ['file' => uploadFixture('x')]],
    'invalid input' => [[]],
]);

it('answers a channel of another organization exactly like a missing one', function () {
    config(['app.debug' => false]);

    $foreign = uploadingAs($this->outsider, $this->other)
        ->postJson($this->url, ['file' => uploadFixture('x')]);

    $missingId = Channel::query()->withoutGlobalScopes()->max('id') + 1;
    $missing = uploadingAs($this->outsider, $this->other)
        ->postJson("/api/channels/{$missingId}/attachments", ['file' => uploadFixture('x')]);

    // The framework echoes the requested id in the message: only that id may differ.
    $body = fn ($response, int $id) => json_decode(str_replace((string) $id, ':id', $response->getContent()), true);

    $foreign->assertNotFound();
    expect($foreign->status())->toBe($missing->status())
        ->and($body($foreign, $this->channel->id))->toBe($body($missing, $missingId));
});

it('requires authentication', function () {
    $this->withHeader('X-Organization-Id', (string) $this->organization->id)
        ->postJson($this->url, ['file' => uploadFixture('x')])
        ->assertUnauthorized();

    expect(storedAttachmentFiles())->toBe([]);
});

it('throttles per user with a translated 429 and does not affect other users', function () {
    for ($i = 0; $i < AppServiceProvider::CHAT_ATTACHMENTS_PER_MINUTE; $i++) {
        uploadingAs($this->member, $this->organization)
            ->postJson($this->url, ['file' => uploadFixture('x')])
            ->assertCreated();
    }

    uploadingAs($this->member, $this->organization)
        ->withHeader('Accept-Language', 'es')
        ->postJson($this->url, ['file' => uploadFixture('x')])
        ->assertStatus(429)
        ->assertHeader('Retry-After')
        ->assertJsonPath('message', fn (string $message) => str_starts_with($message, 'Demasiados intentos'));

    uploadingAs($this->admin, $this->organization)
        ->postJson($this->url, ['file' => uploadFixture('x')])
        ->assertCreated();
});

it('does not expose the file under public storage or by direct URL', function () {
    uploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => uploadFixture('secret')])
        ->assertCreated();

    $path = MessageAttachment::withoutGlobalScopes()->sole()->path;

    expect(Storage::disk('public')->allFiles())->toBe([])
        ->and(Storage::disk('local')->exists($path))->toBeTrue();

    expect(Route::has('storage.local'))->toBeFalse();

    $this->get("/storage/{$path}")->assertNotFound();
});

it('removes the stored file when the row cannot be written', function () {
    MessageAttachment::creating(fn () => throw new RuntimeException('database down'));

    uploadingAs($this->member, $this->organization)
        ->postJson($this->url, ['file' => uploadFixture('x')])
        ->assertServerError();

    expect(storedAttachmentFiles())->toBe([])
        ->and(MessageAttachment::withoutGlobalScopes()->count())->toBe(0);
});
