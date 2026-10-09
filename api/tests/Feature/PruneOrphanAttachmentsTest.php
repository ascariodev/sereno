<?php

use App\Models\Channel;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\Organization;
use App\Models\Project;
use App\Support\CurrentOrganization;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    Storage::fake('local');
    config(['chat.attachments.disk' => 'local', 'chat.attachments.orphan_hours' => 24]);
    $this->travelTo(now()->startOfSecond());
    $this->organization = Organization::factory()->create();
    app(CurrentOrganization::class)->set($this->organization);
    $this->project = Project::factory()->for($this->organization)->create();
    $this->channel = Channel::factory()->for($this->project)->create();
});

function storedAttachment(Channel $channel, string $age, ?Message $message = null, bool $withFile = true): MessageAttachment
{
    $path = "chat/{$channel->organization_id}/{$channel->id}/".fake()->uuid();

    if ($withFile) {
        Storage::disk('local')->put($path, 'data');
    }

    $attachment = new MessageAttachment;
    $attachment->organization_id = $channel->organization_id;
    $attachment->channel_id = $channel->id;
    $attachment->message_id = $message?->id;
    $attachment->disk = 'local';
    $attachment->path = $path;
    $attachment->original_name = 'a.txt';
    $attachment->mime = 'text/plain';
    $attachment->size = 4;
    $attachment->created_at = now()->sub($age);
    $attachment->save();

    return $attachment;
}

function attachmentRowExists(int $id): bool
{
    return DB::table('message_attachments')->where('id', $id)->exists();
}

it('deletes old unlinked attachments with their file and keeps the rest', function () {
    $message = Message::factory()->for($this->channel)->create();
    $old = storedAttachment($this->channel, '25 hours');
    $recent = storedAttachment($this->channel, '23 hours');
    $linked = storedAttachment($this->channel, '3 days', $message);

    $this->artisan('chat:prune-attachments')
        ->expectsOutputToContain('Deleted 1 orphan attachments and 0 stray files.')
        ->assertSuccessful();

    expect(attachmentRowExists($old->id))->toBeFalse()
        ->and(Storage::disk('local')->exists($old->path))->toBeFalse()
        ->and(attachmentRowExists($recent->id))->toBeTrue()
        ->and(Storage::disk('local')->exists($recent->path))->toBeTrue()
        ->and(attachmentRowExists($linked->id))->toBeTrue()
        ->and(Storage::disk('local')->exists($linked->path))->toBeTrue();
});

it('prunes orphans of every organization without an active one', function () {
    $other = Organization::factory()->create();
    $otherProject = Project::factory()->for($other)->create();
    $otherChannel = Channel::factory()->for($otherProject)->create();
    $mine = storedAttachment($this->channel, '2 days');
    $theirs = storedAttachment($otherChannel, '2 days');

    app(CurrentOrganization::class)->set(null);

    $this->artisan('chat:prune-attachments')->assertSuccessful();

    expect(attachmentRowExists($mine->id))->toBeFalse()
        ->and(attachmentRowExists($theirs->id))->toBeFalse()
        ->and(Storage::disk('local')->exists($theirs->path))->toBeFalse();
});

it('works in batches and is idempotent', function () {
    $total = 2 * 200 + 5;
    $first = storedAttachment($this->channel, '2 days');
    $rows = [];
    for ($i = 0; $i < $total - 1; $i++) {
        $rows[] = [
            'organization_id' => $this->organization->id,
            'channel_id' => $this->channel->id,
            'disk' => 'local',
            'path' => 'chat/missing/'.$i,
            'original_name' => 'a.txt',
            'mime' => 'text/plain',
            'size' => 1,
            'created_at' => now()->subDays(2),
        ];
    }
    DB::table('message_attachments')->insert($rows);

    $this->artisan('chat:prune-attachments')
        ->expectsOutputToContain("Deleted {$total} orphan attachments")
        ->assertSuccessful();

    expect(DB::table('message_attachments')->count())->toBe(0)
        ->and(Storage::disk('local')->exists($first->path))->toBeFalse();

    $this->artisan('chat:prune-attachments')
        ->expectsOutputToContain('Deleted 0 orphan attachments and 0 stray files.')
        ->assertSuccessful();
});

it('does not fail when the file is already gone', function () {
    $gone = storedAttachment($this->channel, '2 days', withFile: false);

    $this->artisan('chat:prune-attachments')->assertSuccessful();

    expect(attachmentRowExists($gone->id))->toBeFalse();
});

it('keeps a row that got linked to a message while the command ran', function () {
    $message = Message::factory()->for($this->channel)->create();
    $racing = storedAttachment($this->channel, '2 days');
    $plain = storedAttachment($this->channel, '2 days');

    // Link the first row right after the command read the batch, before it deletes.
    $linked = false;
    DB::listen(function ($query) use ($racing, $message, &$linked) {
        if (! $linked && str_starts_with($query->sql, 'select "id", "disk", "path"')) {
            $linked = true;
            DB::table('message_attachments')->where('id', $racing->id)->update(['message_id' => $message->id]);
        }
    });

    $this->artisan('chat:prune-attachments')
        ->expectsOutputToContain('Deleted 1 orphan attachments')
        ->assertSuccessful();

    expect($linked)->toBeTrue()
        ->and(attachmentRowExists($racing->id))->toBeTrue()
        ->and(Storage::disk('local')->exists($racing->path))->toBeTrue()
        ->and(attachmentRowExists($plain->id))->toBeFalse()
        ->and(Storage::disk('local')->exists($plain->path))->toBeFalse();
});

it('deletes only the stray files older than the period and with no row', function () {
    $disk = Storage::disk('local');
    $withRow = storedAttachment($this->channel, '1 hour');

    $disk->put('chat/1/1/stray-old', 'x');
    $disk->put('chat/1/1/stray-new', 'x');
    $disk->put('chat/1/1/row-old', 'x');
    touch($disk->path('chat/1/1/stray-old'), now()->subHours(30)->getTimestamp());
    touch($disk->path('chat/1/1/row-old'), now()->subHours(30)->getTimestamp());
    touch($disk->path($withRow->path), now()->subHours(30)->getTimestamp());

    $row = new MessageAttachment;
    $row->organization_id = $this->organization->id;
    $row->channel_id = $this->channel->id;
    $row->disk = 'local';
    $row->path = 'chat/1/1/row-old';
    $row->original_name = 'a.txt';
    $row->mime = 'text/plain';
    $row->size = 1;
    $row->save();

    $this->artisan('chat:prune-attachments')
        ->expectsOutputToContain('Deleted 0 orphan attachments and 1 stray files.')
        ->assertSuccessful();

    expect($disk->exists('chat/1/1/stray-old'))->toBeFalse()
        ->and($disk->exists('chat/1/1/stray-new'))->toBeTrue()
        ->and($disk->exists('chat/1/1/row-old'))->toBeTrue()
        ->and($disk->exists($withRow->path))->toBeTrue();
});

it('finds stray files in every organization and channel directory', function () {
    $disk = Storage::disk('local');
    $paths = ['chat/loose', 'chat/7/loose', 'chat/7/3/old', 'chat/8/4/old', 'chat/8/4/deep/old'];

    foreach ($paths as $path) {
        $disk->put($path, 'x');
        touch($disk->path($path), now()->subHours(30)->getTimestamp());
    }

    $this->artisan('chat:prune-attachments')
        ->expectsOutputToContain('Deleted 0 orphan attachments and 5 stray files.')
        ->assertSuccessful();

    expect($disk->allFiles('chat'))->toBe([]);
});

it('refuses to delete anything with an invalid orphan period', function (mixed $hours) {
    config(['chat.attachments.orphan_hours' => $hours]);
    $old = storedAttachment($this->channel, '5 days');

    $this->artisan('chat:prune-attachments')->assertFailed();

    expect(attachmentRowExists($old->id))->toBeTrue();
})->with([0, -3, null, '24']);

it('is scheduled daily', function () {
    Artisan::call('schedule:list');

    expect(Artisan::output())->toContain('chat:prune-attachments');
});
