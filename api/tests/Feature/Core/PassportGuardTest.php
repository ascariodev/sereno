<?php

use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\PersonalAccessTokenFactory;

function issuePassportToken(User $user, array $scopes = ['mcp:use']): string
{
    app(ClientRepository::class)->createPersonalAccessGrantClient('Test', 'users');

    return app(PersonalAccessTokenFactory::class)->make($user->getKey(), 'test', $scopes, 'users')->accessToken;
}

beforeEach(function () {
    usePassportTestKeys();

    $whoAmI = fn (Request $request) => [
        'id' => $request->user()->getKey(),
        'can_mcp_use' => $request->user()->tokenCan('mcp:use'),
    ];

    Route::middleware('auth:api')->get('/test/passport-user', $whoAmI);
    Route::middleware('auth:sanctum')->get('/test/sanctum-user', $whoAmI);
});

it('resolves a passport token with auth:api and its scopes', function () {
    $user = User::factory()->create();

    $this->withToken(issuePassportToken($user))
        ->getJson('/test/passport-user')
        ->assertOk()
        ->assertExactJson(['id' => $user->id, 'can_mcp_use' => true]);
});

it('does not grant scopes the passport token lacks', function () {
    $user = User::factory()->create();

    $this->withToken(issuePassportToken($user, []))
        ->getJson('/test/passport-user')
        ->assertOk()
        ->assertExactJson(['id' => $user->id, 'can_mcp_use' => false]);
});

it('rejects a revoked passport token', function () {
    $user = User::factory()->create();
    $token = issuePassportToken($user);
    DB::table('oauth_access_tokens')->update(['revoked' => true]);

    $this->withToken($token)->getJson('/test/passport-user')->assertUnauthorized();
});

it('keeps resolving session and access tokens with auth:sanctum', function () {
    $user = User::factory()->create();
    $session = $user->createToken('web')->plainTextToken;
    $access = $user->createAccessToken(Organization::factory()->create(), 'claude')->plainTextToken;

    $this->withToken($session)->getJson('/test/sanctum-user')->assertOk()->assertJsonPath('id', $user->id);
    $this->app['auth']->forgetGuards();
    $this->withToken($access)->getJson('/test/sanctum-user')->assertOk()->assertJsonPath('id', $user->id);
});

it('does not cross tokens between the two guards', function () {
    $user = User::factory()->create();
    $passport = issuePassportToken($user);
    $session = $user->createToken('web')->plainTextToken;

    $this->withToken($passport)->getJson('/test/sanctum-user')->assertUnauthorized();
    $this->app['auth']->forgetGuards();
    $this->withToken($session)->getJson('/test/passport-user')->assertUnauthorized();
});
