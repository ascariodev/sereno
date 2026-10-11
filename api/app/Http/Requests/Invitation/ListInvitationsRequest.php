<?php

namespace App\Http\Requests\Invitation;

use App\Models\Invitation;
use Carbon\Carbon;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Pagination\Cursor;
use Illuminate\Support\Facades\Gate;
use Throwable;

class ListInvitationsRequest extends FormRequest
{
    public const DEFAULT_PER_PAGE = 100;

    public const MAX_PER_PAGE = 100;

    public function authorize(): bool
    {
        return Gate::allows('viewAny', Invitation::class);
    }

    public function rules(): array
    {
        return [
            'cursor' => ['nullable', 'string', $this->validCursor(...)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
        ];
    }

    private function validCursor(string $attribute, mixed $value, Closure $fail): void
    {
        $parameters = Cursor::fromEncoded($value)?->toArray() ?? [];
        $id = $parameters['id'] ?? null;
        $createdAt = $parameters['created_at'] ?? null;

        if (! is_int($id) || $id < 1 || ! $this->isTimestamp($createdAt)) {
            $fail(__('The cursor is invalid.'));
        }
    }

    private function isTimestamp(mixed $value): bool
    {
        if (! is_string($value) || ! preg_match('/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/', $value)) {
            return false;
        }

        try {
            Carbon::parse($value);
        } catch (Throwable) {
            return false;
        }

        return true;
    }

    public function perPage(): int
    {
        return (int) ($this->validated('per_page') ?? self::DEFAULT_PER_PAGE);
    }
}
