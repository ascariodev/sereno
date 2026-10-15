<?php

use App\Models\Organization;
use App\Models\PersonalAccessToken;
use App\Models\User;

it('creates an access token bound to an organization with the mcp ability', function () {
    $user = User::factory()->create();
    $organization = Organization::factory()->create();

    $new = $user->createAccessToken($organization, 'claude', now()->addDays(30));

    $token = PersonalAccessToken::findToken($new->plainTextToken);
    expect($token)->toBeInstanceOf(PersonalAccessToken::class)
        ->and($token->organization_id)->toBe($organization->id)
        ->and($token->organization->is($organization))->toBeTrue()
        ->and($token->isAccessToken())->toBeTrue()
        ->and($token->can('mcp'))->toBeTrue()
        ->and($token->can('other'))->toBeFalse()
        ->and($token->expires_at)->not->toBeNull();
});

it('keeps session tokens without an organization', function () {
    $user = User::factory()->create();

    $token = PersonalAccessToken::findToken($user->createToken('web')->plainTextToken);

    expect($token->organization_id)->toBeNull()
        ->and($token->isAccessToken())->toBeFalse();
});

it('deletes access tokens when the organization is deleted', function () {
    $user = User::factory()->create();
    $organization = Organization::factory()->create();
    $user->createAccessToken($organization, 'claude');
    $session = $user->createToken('web')->accessToken;

    $organization->delete();

    expect(PersonalAccessToken::query()->pluck('id')->all())->toBe([$session->id]);
});
