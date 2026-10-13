<?php

namespace App\Support;

class MailMarkdown
{
    /**
     * Backslash-escapes only what forms emphasis, links, images or inline HTML in user text placed in a MailMessage
     * line, which is rendered as Markdown. The plain-text part of the mail shows these backslashes, so nothing else is escaped.
     */
    public static function escape(string $text): string
    {
        return preg_replace_callback('/[\\\\*_\[\]()<>]|!(?=\[)/', fn (array $match) => '\\'.$match[0], $text);
    }
}
