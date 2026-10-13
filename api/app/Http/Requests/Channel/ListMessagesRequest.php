<?php

namespace App\Http\Requests\Channel;

use App\Http\Requests\CursorPaginatedRequest;
use App\Models\Message;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Gate;

class ListMessagesRequest extends CursorPaginatedRequest
{
    public function authorize(): bool
    {
        $message = $this->route('message');

        throw_if(
            $message instanceof Message && ($message->channel_id !== $this->route('channel')->id || $message->parent_id !== null),
            ModelNotFoundException::class,
        );

        return Gate::authorize('view', $this->route('channel'))->allowed();
    }

    public function rules(): array
    {
        return parent::rules() + [
            'around' => ['nullable', 'integer', 'min:1', 'max:'.PHP_INT_MAX],
        ];
    }

    public function around(): ?int
    {
        return $this->filled('cursor') || $this->validated('around') === null ? null : (int) $this->validated('around');
    }
}
