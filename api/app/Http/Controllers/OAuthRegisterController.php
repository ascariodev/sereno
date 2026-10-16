<?php

namespace App\Http\Controllers;

use Laravel\Mcp\Server\Http\Controllers\OAuthRegisterController as BaseOAuthRegisterController;

/**
 * The package checks redirect_uris with a string prefix, so dot segments (raw or percent-encoded) could leave
 * the allowed path once a browser normalizes them.
 */
class OAuthRegisterController extends BaseOAuthRegisterController
{
    protected function isValidRedirectUri(string $value): bool
    {
        return parent::isValidRedirectUri($value) && ! $this->hasDotSegments($value);
    }

    private function hasDotSegments(string $value): bool
    {
        $path = rawurldecode((string) parse_url($value, PHP_URL_PATH));

        foreach (preg_split('#[/\\\\]#', $path) as $segment) {
            if ($segment === '.' || $segment === '..') {
                return true;
            }
        }

        return false;
    }
}
