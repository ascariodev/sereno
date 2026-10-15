<?php

use App\Jobs\IngestLogEvents;
use App\Models\LogSource;
use App\Models\Organization;
use App\Models\Project;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

function sdkVectors(): array
{
    return json_decode(file_get_contents(__DIR__.'/../../Fixtures/sdk/vectores.json'), true, 512, JSON_THROW_ON_ERROR);
}

function sdkVectorExpand(mixed $value): mixed
{
    if (! is_array($value)) {
        return $value;
    }

    if (count($value) === 1 && array_key_exists('$repeat', $value)) {
        return str_repeat($value['$repeat'][0], $value['$repeat'][1]);
    }

    return array_map(sdkVectorExpand(...), $value);
}

beforeEach(function () {
    $this->organization = Organization::factory()->create();
    $this->project = Project::factory()->for($this->organization)->create();
    $this->plainKey = LogSource::newPlainKey();
    LogSource::factory()->for($this->project)->withPlainKey($this->plainKey)->create();
});

it('has vectors to check', function () {
    expect(sdkVectors())->not->toBeEmpty();
});

it('accepts the expected event of every SDK vector', function (array $vector) {
    Queue::fake();

    $event = ['id' => (string) Str::uuid(), ...sdkVectorExpand($vector['expected'])];

    $this->withToken($this->plainKey)
        ->postJson('/api/ingest/events', ['events' => [$event]])
        ->assertStatus(202)
        ->assertJson(['accepted' => 1]);

    Queue::assertPushed(IngestLogEvents::class);
})->with(fn () => collect(sdkVectors())->mapWithKeys(fn (array $vector) => [$vector['name'] => [$vector]])->all());
