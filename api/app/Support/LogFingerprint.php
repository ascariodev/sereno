<?php

namespace App\Support;

class LogFingerprint
{
    /**
     * Only this many bytes of the message take part in grouping: it bounds the cost of the
     * normalization regexes on huge messages.
     */
    public const MESSAGE_MAX_BYTES = 1024;

    /**
     * Ordered: emails and UUIDs before IPs and hex, and everything before plain numbers, so a
     * placeholder never ends up half replaced.
     *
     * @var array<string, string>
     */
    private const PLACEHOLDERS = [
        '/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/' => '<email>',
        '/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i' => '<uuid>',
        '/\b(?:\d{1,3}\.){3}\d{1,3}\b/' => '<ip>',
        '/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i' => '<ip>',
        '/\b(?:0x)?[0-9a-f]{12,}\b/i' => '<hex>',
        '/\d+/' => '<n>',
        '/\s+/' => ' ',
    ];

    /**
     * The level is left out on purpose: the same failure logged as warning and later as error is
     * one problem, and the group keeps the highest level seen.
     */
    public static function for(string $message, ?string $explicit = null): string
    {
        $explicit = $explicit === null ? '' : trim($explicit);

        if ($explicit !== '') {
            return hash('sha256', 'explicit:'.$explicit);
        }

        return hash('sha256', 'message:'.self::normalize($message));
    }

    public static function normalize(string $message): string
    {
        $normalized = substr($message, 0, self::MESSAGE_MAX_BYTES);

        foreach (self::PLACEHOLDERS as $pattern => $placeholder) {
            $normalized = preg_replace($pattern, $placeholder, $normalized) ?? $normalized;
        }

        return trim($normalized);
    }
}
