<?php

namespace App\Mcp\Tools;

use App\Http\Controllers\Api\MessageController;
use App\Http\Requests\CursorPaginatedRequest;
use App\Http\Resources\MessageResource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Pagination\Cursor;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('Reads the channel of a project, newest first. Without thread_id it returns the top-level messages, each with replies_count and its latest reply authors. With thread_id it returns the replies of that message, plus the message itself in meta.root. When next_cursor is not null, pass it as cursor to get older messages.')]
#[Name('list-channel-messages')]
#[IsReadOnly]
#[IsIdempotent]
class ListChannelMessagesTool extends Tool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->integer()
                ->description('Id of the project whose channel to read, as returned by list-projects.')
                ->required(),
            'thread_id' => $schema->integer()
                ->description('Id of a top-level message, to read its replies instead of the channel.'),
            'cursor' => $schema->string()
                ->description('Value of next_cursor from the previous call, to read older messages.'),
            'per_page' => $schema->integer()
                ->description('Messages per page. Defaults to '.CursorPaginatedRequest::DEFAULT_PER_PAGE.'; at most '.CursorPaginatedRequest::MAX_PER_PAGE.'.'),
        ];
    }

    protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory
    {
        $arguments = $request->validate([
            'project_id' => ['required', 'integer', 'min:1'],
            'thread_id' => ['nullable', 'integer', 'min:1'],
            'cursor' => ['nullable', 'string'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.CursorPaginatedRequest::MAX_PER_PAGE],
        ]);

        $project = Project::query()->findOrFail($arguments['project_id']);
        $this->authorize($user, 'view', $project);

        $channel = $project->channel()->firstOrFail();
        $this->authorize($user, 'view', $channel);

        $cursor = isset($arguments['cursor']) ? Cursor::fromEncoded($arguments['cursor']) : null;
        if (isset($arguments['cursor'])) {
            $id = $cursor?->toArray()['id'] ?? null;
            if (! is_int($id) || $id < 1) {
                return Response::error(__('The cursor is invalid.'));
            }
        }
        $perPage = $arguments['per_page'] ?? CursorPaginatedRequest::DEFAULT_PER_PAGE;

        if (isset($arguments['thread_id'])) {
            $root = $channel->messages()
                ->whereNull('parent_id')
                ->findOrFail($arguments['thread_id']);

            $page = $channel->messages()
                ->where('parent_id', $root->id)
                ->whereNull('deleted_at')
                ->orderByDesc('id')
                ->cursorPaginate($perPage, cursor: $cursor);

            (new Collection([...$page->items(), $root]))->load(MessageController::RELATIONS);
            MessageController::loadParticipants([$root]);

            return $this->structured([
                'data' => MessageResource::collection($page->getCollection())->resolve(),
                'next_cursor' => $page->nextCursor()?->encode(),
                'meta' => ['root' => (new MessageResource($root))->resolve()],
            ]);
        }

        $page = $channel->messages()
            ->whereNull('parent_id')
            ->where(fn ($query) => $query->whereNull('deleted_at')->orWhere('replies_count', '>', 0))
            ->with(MessageController::RELATIONS)
            ->orderByDesc('id')
            ->cursorPaginate($perPage, cursor: $cursor);

        MessageController::loadParticipants($page->items());

        return $this->structured([
            'data' => MessageResource::collection($page->getCollection())->resolve(),
            'next_cursor' => $page->nextCursor()?->encode(),
        ]);
    }
}
