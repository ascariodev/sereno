<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\OAuth\ApproveAuthorizationRequest;
use App\Models\McpOauthGrant;
use App\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Laravel\Passport\Bridge\User as PassportUser;
use League\OAuth2\Server\AuthorizationServer;
use League\OAuth2\Server\Entities\ScopeEntityInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use League\OAuth2\Server\RequestTypes\AuthorizationRequestInterface;
use LogicException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Consent for the SPA, without Passport's session: every call carries the authorization query string and is validated
 * again, so the approval never trusts what an earlier GET showed.
 */
class OAuthAuthorizationController extends Controller
{
    public const SCOPE = 'mcp:use';

    public function __construct(private readonly AuthorizationServer $server) {}

    public function show(Request $request, ServerRequestInterface $psrRequest): JsonResponse
    {
        return $this->withOAuthErrors(function () use ($request, $psrRequest) {
            $authRequest = $this->validateAuthorizationRequest($psrRequest);
            $client = $authRequest->getClient();

            return response()->json([
                'client' => ['id' => $client->getIdentifier(), 'name' => $client->getName()],
                'redirect_host' => parse_url($this->redirectUri($authRequest), PHP_URL_HOST),
                'scopes' => [self::SCOPE],
                'organizations' => $request->user()->organizations()
                    ->orderBy('name')
                    ->get(['organizations.id', 'organizations.name'])
                    ->map(fn ($organization) => ['id' => $organization->id, 'name' => $organization->name])
                    ->all(),
            ]);
        });
    }

    public function approve(ApproveAuthorizationRequest $request, ServerRequestInterface $psrRequest, ResponseInterface $psrResponse): JsonResponse
    {
        return $this->withOAuthErrors(function () use ($request, $psrRequest, $psrResponse) {
            $authRequest = $this->validateAuthorizationRequest($psrRequest);
            $user = $request->user();
            $authRequest->setUser(new PassportUser((string) $user->getKey()));
            $authRequest->setAuthorizationApproved(true);

            $response = DB::transaction(function () use ($authRequest, $user, $request, $psrResponse) {
                $organizationId = (int) $request->validated('organization_id');

                // Same lock as Organization::removeMember: the membership is checked again under it, so a removal
                // either revokes this grant or is seen here before it is created.
                Organization::query()->whereKey($organizationId)->lockForUpdate()->first();
                validator(['organization_id' => $organizationId], $request->rules())->validate();

                $clientId = $authRequest->getClient()->getIdentifier();
                $grant = McpOauthGrant::query()->where('client_id', $clientId)->where('user_id', $user->getKey())->first()
                    ?? new McpOauthGrant;
                $grant->client_id = $clientId;
                $grant->user_id = $user->getKey();
                $grant->organization_id = $organizationId;
                $grant->save();

                return $this->server->completeAuthorizationRequest($authRequest, $psrResponse);
            });

            return response()->json(['redirect_url' => $response->getHeaderLine('Location')]);
        });
    }

    public function deny(Request $request, ServerRequestInterface $psrRequest, ResponseInterface $psrResponse): JsonResponse
    {
        return $this->withOAuthErrors(function () use ($request, $psrRequest, $psrResponse) {
            $authRequest = $this->validateAuthorizationRequest($psrRequest);
            $authRequest->setUser(new PassportUser((string) $request->user()->getKey()));
            $authRequest->setAuthorizationApproved(false);

            try {
                $this->server->completeAuthorizationRequest($authRequest, $psrResponse);
            } catch (OAuthServerException $denied) {
                if ($denied->getErrorType() !== 'access_denied' || $denied->getRedirectUri() === null) {
                    throw $denied;
                }

                return response()->json([
                    'redirect_url' => $denied->generateHttpResponse($psrResponse)->getHeaderLine('Location'),
                ]);
            }

            throw new LogicException('The denied authorization request was not rejected.');
        });
    }

    private function validateAuthorizationRequest(ServerRequestInterface $psrRequest): AuthorizationRequestInterface
    {
        // Without "scope" the client asks for the MCP server, the only thing it can be granted. A Passport default
        // scope would also reach personal access tokens issued without scopes.
        $query = $psrRequest->getQueryParams();
        $authRequest = $this->server->validateAuthorizationRequest(
            array_key_exists('scope', $query) ? $psrRequest : $psrRequest->withQueryParams($query + ['scope' => self::SCOPE]),
        );

        // league defaults to "plain" and only requires PKCE for public clients; Claude always sends S256.
        if ($authRequest->getCodeChallenge() === null || $authRequest->getCodeChallengeMethod() !== 'S256') {
            throw OAuthServerException::invalidRequest('code_challenge_method', 'PKCE with S256 is required.');
        }

        $scopes = collect($authRequest->getScopes())
            ->map(fn (ScopeEntityInterface $scope) => $scope->getIdentifier())
            ->unique()
            ->values()
            ->all();

        if ($scopes !== [self::SCOPE]) {
            throw OAuthServerException::invalidScope(implode(' ', $scopes));
        }

        $this->ensureResourceIsMcp($query);

        return $authRequest;
    }

    /**
     * RFC 8707: "resource" must be /mcp, the value of its protected resource metadata, so a client cannot be led to
     * believe the token is bound to another server. It stays optional, as in the RFC, because the tokens only work
     * on /mcp anyway.
     *
     * @param  array<string, mixed>  $query
     */
    private function ensureResourceIsMcp(array $query): void
    {
        if (! array_key_exists('resource', $query)) {
            return;
        }

        $resource = $query['resource'];

        if (! is_string($resource) || rtrim($resource, '/') !== url('/mcp')) {
            throw new OAuthServerException('The requested resource is not this MCP server.', 3, 'invalid_target', 400);
        }
    }

    private function redirectUri(AuthorizationRequestInterface $authRequest): string
    {
        $registered = $authRequest->getClient()->getRedirectUri();

        return $authRequest->getRedirectUri() ?? (is_array($registered) ? $registered[0] : $registered);
    }

    /**
     * Errors answer 400 in JSON and never redirect: a 401 (league's invalid_client) would log the SPA out, and the
     * consent screen shows the error instead of sending the browser to a redirect_uri that may not be validated.
     */
    private function withOAuthErrors(callable $callback): JsonResponse
    {
        try {
            return $callback();
        } catch (OAuthServerException $exception) {
            $error = $exception->getErrorType();

            return response()->json([
                'error' => $error,
                'message' => match ($error) {
                    'invalid_client' => __('The application is not registered or its return address does not match.'),
                    'invalid_scope' => __('The application asked for permissions that are not allowed.'),
                    default => __('The authorization request is invalid.'),
                },
            ], 400);
        }
    }
}
