<?php

namespace App\Support;

final readonly class UpsertedLogGroup
{
    public function __construct(
        public int $id,
        public string $level,
        public string $title,
        public int $eventsCount,
        public string $status,
        public ?string $previousStatus,
    ) {}

    public static function fromRow(object $row): self
    {
        return new self(
            (int) $row->id,
            $row->level,
            $row->title,
            (int) $row->events_count,
            $row->status,
            $row->previous_status,
        );
    }
}
