<?php

namespace App\Http\Requests\TaskComment;

use App\Models\Task;
use App\Models\TaskComment;
use Closure;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Pagination\Cursor;
use Illuminate\Support\Facades\Gate;

class ListTaskCommentsRequest extends FormRequest
{
    public const DEFAULT_PER_PAGE = 30;

    public const MAX_PER_PAGE = 100;

    public function authorize(): bool
    {
        /** @var Task $task */
        $task = $this->route('task');

        throw_unless($task->project_id === $this->route('project')->id, ModelNotFoundException::class);

        return Gate::authorize('viewAny', [TaskComment::class, $task])->allowed();
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
}
