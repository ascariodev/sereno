<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Laravel\Passport\Client;
use Laravel\Passport\RefreshToken;
use Laravel\Passport\Token;

class McpOauthGrant extends Model
{
    protected $guarded = ['*'];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function revoke(): void
    {
        $tokens = Token::query()
            ->where('user_id', $this->user_id)
            ->where('client_id', $this->client_id);

        RefreshToken::query()
            ->whereIn('access_token_id', (clone $tokens)->select('id'))
            ->update(['revoked' => true]);

        $tokens->update(['revoked' => true]);

        $this->delete();
    }
}
