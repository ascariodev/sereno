<?php

namespace App\Http\Requests;

use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Pagination\Cursor;

abstract class CursorPaginatedRequest extends FormRequest
{
    public const DEFAULT_PER_PAGE = 50;

    public const MAX_PER_PAGE = 100;

    public function rules(): array
    {
        return [
            'cursor' => ['nullable', 'string', $this->validCursor(...)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.static::MAX_PER_PAGE],
        ];
    }

    private function validCursor(string $attribute, mixed $value, Closure $fail): void
    {
        if (! static::isValidCursor($value)) {
            $fail(__('The cursor is invalid.'));
        }
    }

    public static function isValidCursor(mixed $value): bool
    {
        if (! is_string($value)) {
            return false;
        }

        $id = Cursor::fromEncoded($value)?->toArray()['id'] ?? null;

        return is_int($id) && $id >= 1;
    }

    public function perPage(): int
    {
        return (int) ($this->validated('per_page') ?? static::DEFAULT_PER_PAGE);
    }
}
