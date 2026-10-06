<?php

namespace App\Http\Requests\LogGroup;

use App\Enums\LogGroupStatus;
use App\Enums\LogLevel;
use App\Models\LogGroup;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class ListLogGroupsRequest extends FormRequest
{
    public const DEFAULT_PER_PAGE = 25;

    public const MAX_PER_PAGE = 100;

    public function authorize(): bool
    {
        return Gate::allows('viewAny', LogGroup::class);
    }

    public function rules(): array
    {
        return [
            'status' => ['nullable', Rule::enum(LogGroupStatus::class)],
            'level' => ['nullable', Rule::enum(LogLevel::class)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
        ];
    }

    public function perPage(): int
    {
        return (int) ($this->validated('per_page') ?? self::DEFAULT_PER_PAGE);
    }

    public function status(): ?LogGroupStatus
    {
        return LogGroupStatus::tryFrom((string) $this->validated('status'));
    }

    public function minimumLevel(): ?LogLevel
    {
        return LogLevel::tryFrom((string) $this->validated('level'));
    }
}
