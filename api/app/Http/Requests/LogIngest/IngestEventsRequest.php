<?php

namespace App\Http\Requests\LogIngest;

use App\Enums\LogLevel;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class IngestEventsRequest extends FormRequest
{
    public const MAX_EVENTS = 100;

    public const MAX_MESSAGE_LENGTH = 8192;

    public const MAX_CONTEXT_BYTES = 32768;

    public const MAX_CONTEXT_DEPTH = 8;

    /** 100 events of 8 KB + 32 KB is about 4 MB; the margin covers JSON overhead. */
    public const MAX_BODY_BYTES = 5 * 1024 * 1024;

    public function authorize(): bool
    {
        abort_if(strlen($this->getContent()) > self::MAX_BODY_BYTES, 413, __('The request body is too large.'));

        return true;
    }

    public function rules(): array
    {
        return [
            'events' => ['required', 'array', 'min:1', 'max:'.self::MAX_EVENTS],
            'events.*' => ['required', 'array'],
            'events.*.level' => ['required', 'string', Rule::enum(LogLevel::class)],
            'events.*.message' => ['required', 'string', 'max:'.self::MAX_MESSAGE_LENGTH, $this->noNullBytesRule(...)],
            'events.*.context' => ['nullable', 'array', $this->contextRule(...)],
            'events.*.occurred_at' => ['nullable', 'string', 'date'],
            'events.*.fingerprint' => ['nullable', 'string', 'max:255', $this->noNullBytesRule(...)],
        ];
    }

    /** Postgres text and jsonb cannot store U+0000: it would fail the insert inside the job. */
    private function noNullBytesRule(string $attribute, mixed $value, Closure $fail): void
    {
        if (self::containsNullByte($value)) {
            $fail(__('The :attribute must not contain null characters.', ['attribute' => $attribute]));
        }
    }

    private static function containsNullByte(mixed $value): bool
    {
        if (is_string($value)) {
            return str_contains($value, "\0");
        }

        if (! is_array($value)) {
            return false;
        }

        foreach ($value as $key => $item) {
            if (self::containsNullByte($key) || self::containsNullByte($item)) {
                return true;
            }
        }

        return false;
    }

    private function contextRule(string $attribute, mixed $value, Closure $fail): void
    {
        if (self::depth($value) > self::MAX_CONTEXT_DEPTH) {
            $fail(__('The :attribute is nested too deeply.', ['attribute' => $attribute]));

            return;
        }

        $this->noNullBytesRule($attribute, $value, $fail);

        if (strlen(json_encode($value, JSON_PARTIAL_OUTPUT_ON_ERROR) ?: '') > self::MAX_CONTEXT_BYTES) {
            $fail(__('The :attribute must not exceed :max KB when serialized.', [
                'attribute' => $attribute,
                'max' => self::MAX_CONTEXT_BYTES / 1024,
            ]));
        }
    }

    private static function depth(mixed $value, int $level = 0): int
    {
        if (! is_array($value) || $level > self::MAX_CONTEXT_DEPTH) {
            return $level;
        }

        $deepest = $level + 1;

        foreach ($value as $item) {
            $deepest = max($deepest, self::depth($item, $level + 1));
        }

        return $deepest;
    }
}
