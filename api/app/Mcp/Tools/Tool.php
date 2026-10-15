<?php

namespace App\Mcp\Tools;

use App\Models\Organization;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Tool as McpTool;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

abstract class Tool extends McpTool
{
    public function handle(Request $request): Response|ResponseFactory
    {
        $user = $request->user();
        $organization = app(CurrentOrganization::class)->get();

        if (! $user instanceof User || $organization === null) {
            return Response::error(__('You do not belong to this organization.'));
        }

        $request->setArguments($this->normalize($request->toArray()));

        try {
            return $this->run($request, $user, $organization);
        } catch (AuthorizationException $exception) {
            return Response::error($exception->status() === 404 ? __('Not found.') : __('You are not allowed to do this.'));
        } catch (NotFoundHttpException|ModelNotFoundException) {
            return Response::error(__('Not found.'));
        }
    }

    /**
     * Mirrors the TrimStrings and ConvertEmptyStringsToNull middleware, which MCP calls skip.
     *
     * @param  array<array-key, mixed>  $data
     * @return array<array-key, mixed>
     */
    private function normalize(array $data): array
    {
        return array_map(function (mixed $value): mixed {
            if (is_array($value)) {
                return $this->normalize($value);
            }

            return is_string($value) ? (Str::trim($value) === '' ? null : Str::trim($value)) : $value;
        }, $data);
    }

    abstract protected function run(Request $request, User $user, Organization $organization): Response|ResponseFactory;

    protected function authorize(User $user, string $ability, mixed $arguments = []): void
    {
        Gate::forUser($user)->authorize($ability, $arguments);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    protected function structured(array $data): ResponseFactory
    {
        return Response::structured(json_decode(json_encode($data, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR));
    }
}
