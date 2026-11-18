<?php

namespace Lopyta\MailGateway;

use Lopyta\MailGateway\Exceptions\GatewayRejectedException;

class WebhookVerifier
{
    public static function verifySignature(string $rawBody, ?string $signatureHeader, string $webhookSecret): bool
    {
        if ($webhookSecret === '' || $signatureHeader === null || trim($signatureHeader) === '') {
            return false;
        }

        $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $webhookSecret);
        return hash_equals($expected, trim($signatureHeader));
    }

    /**
     * @return array<string, mixed>
     */
    public static function parse(string $rawBody, ?string $signatureHeader, string $webhookSecret): array
    {
        if (!self::verifySignature($rawBody, $signatureHeader, $webhookSecret)) {
            throw new GatewayRejectedException('Signature webhook gateway tidak valid.', 403, 'invalid_signature');
        }

        try {
            $decoded = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new GatewayRejectedException('Payload JSON webhook tidak valid.', 400, 'invalid_json');
        }

        if (!is_array($decoded) || empty($decoded['event'])) {
            throw new GatewayRejectedException('Struktur payload webhook Lopyta tidak lengkap.', 400, 'invalid_payload');
        }

        return $decoded;
    }
}
