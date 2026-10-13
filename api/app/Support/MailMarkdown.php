<?php

namespace App\Support;

class MailMarkdown
{
    /**
     * Backslash-escapes the Markdown punctuation of user text placed in a MailMessage line, which is rendered as
     * Markdown (a `[x](url)` would become a link). `&`, `<` and `>` are left alone: Blade already escapes them.
     */
    public static function escape(string $text): string
    {
        return preg_replace_callback('/[\\\\`*_\[\]()#+\-.!|{}~=]/', fn (array $match) => '\\'.$match[0], $text);
    }
}
