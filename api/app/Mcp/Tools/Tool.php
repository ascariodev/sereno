<?php

namespace App\Mcp\Tools;

use App\Models\Organization;
use App\Models\User;
use App\Support\CurrentOrganization;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Gate;
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

        try {
            return $this->run($request, $user, $organization);
        } catch (AuthorizationException $exception) {
            return Response::error($exception->status() === 404 ? __('Not found.') : __('You are not allowed to do this.'));
        } catch (NotFoundHttpException|ModelNotFoundException) {
            return Response::error(__('Not found.'));
        }
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
