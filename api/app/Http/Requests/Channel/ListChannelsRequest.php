<?php

namespace App\Http\Requests\Channel;

use App\Models\Channel;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Pagination\Cursor;
use Illuminate\Support\Facades\Gate;

class ListChannelsRequest extends FormRequest
{
    public const DEFAULT_PER_PAGE = 100;

    public const MAX_PER_PAGE = 100;

    public function authorize(): bool
    {
        return Gate::allows('viewAny', Channel::class);
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
        $id = Cursor::fromEncoded($value)?->toArray()['id'] ?? null;

        if (! is_int($id) || $id < 1) {
            $fail(__('The cursor is invalid.'));
        }
    }

    public function perPage(): int
    {
        return (int) ($this->validated('per_page') ?? self::DEFAULT_PER_PAGE);
    }

    public function includeArchived(): bool
    {
        return $this->boolean('include_archived');
    }
}
