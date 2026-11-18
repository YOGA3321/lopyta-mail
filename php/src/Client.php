<?php

namespace Lopyta\MailGateway;

use Lopyta\MailGateway\Exceptions\GatewayRejectedException;
use Lopyta\MailGateway\Exceptions\TransientGatewayException;

/**
 * Klien HTTP zero-dependency untuk Lopyta Centralized Email Gateway (PHP 8.1+ Native / Composer).
 */
class Client
{
    private string $baseUrl;
    private string $clientId;
    private string $clientSecret;
    private int $timeoutSeconds;
    private int $inlineMaxAttempts;
    private int $inlineDelayMs;

    /** @var callable|null */
    private $transport;

    public function __construct(
        string $clientId = '',
        string $clientSecret = '',
        string $baseUrl = 'https://lopyta.com',
        int $timeoutSeconds = 30,
        int $inlineMaxAttempts = 2,
        int $inlineDelayMs = 400,
        ?callable $transport = null
    ) {
        $base = rtrim(trim($baseUrl), '/');
        $this->baseUrl = $base !== '' ? $base : 'https://lopyta.com';
        $this->clientId = trim($clientId);
        $this->clientSecret = trim($clientSecret);
        $this->timeoutSeconds = max(1, $timeoutSeconds);
        $this->inlineMaxAttempts = max(1, $inlineMaxAttempts);
        $this->inlineDelayMs = max(50, $inlineDelayMs);
        $this->transport = $transport;
    }

    public function isConfigured(): bool
    {
        return $this->baseUrl !== '' && $this->clientId !== '' && $this->clientSecret !== '';
    }

    public static function fromEnv(): self
    {
        $url = getenv('LOPYTA_GATEWAY_URL') ?: getenv('SEO_GATEWAY_URL') ?: 'https://lopyta.com';
        $id = (string) (getenv('LOPYTA_GATEWAY_CLIENT_ID') ?: getenv('SEO_GATEWAY_CLIENT_ID') ?: '');
        $secret = (string) (getenv('LOPYTA_GATEWAY_CLIENT_SECRET') ?: getenv('SEO_GATEWAY_CLIENT_SECRET') ?: '');
        $timeout = (int) (getenv('LOPYTA_GATEWAY_TIMEOUT') ?: getenv('SEO_GATEWAY_TIMEOUT') ?: 30);

        return new self($id, $secret, $url, $timeout > 0 ? $timeout : 30);
    }

    public function send(array $payload): array
    {
        return $this->request('POST', '/api/v1/send', $payload);
    }

    public function broadcast(array $payload): array
    {
        $recipients = $payload['recipients'] ?? [];
        if (!is_array($recipients) || count($recipients) === 0) {
            throw new GatewayRejectedException('Array recipients broadcast tidak boleh kosong.', 400, 'bad_request');
        }

        if (count($recipients) <= 25000) {
            return $this->request('POST', '/api/v1/broadcast', $payload, max($this->timeoutSeconds, 60));
        }

        $chunks = array_chunk($recipients, 25000);
        $first = null;
        $totalAccepted = 0;
        $totalSkipped = 0;

        foreach ($chunks as $idx => $chunk) {
            $chunkPayload = $payload;
            $chunkPayload['recipients'] = $chunk;
            if (!empty($payload['external_batch_id'])) {
                $chunkPayload['external_batch_id'] = $payload['external_batch_id'] . '-part-' . ($idx + 1);
            }
            $res = $this->request('POST', '/api/v1/broadcast', $chunkPayload, max($this->timeoutSeconds, 60));
            $first ??= $res;
            $totalAccepted += (int) ($res['accepted_count'] ?? 0);
            $totalSkipped += (int) ($res['skipped_invalid_count'] ?? 0);
        }

        $first['accepted_count'] = $totalAccepted;
        $first['skipped_invalid_count'] = $totalSkipped;
        return $first;
    }

    public function me(): array
    {
        $res = $this->request('GET', '/api/v1/me');
        return $res['client'] ?? $res;
    }

    public function usage(): array
    {
        return $this->request('GET', '/api/v1/usage');
    }

    public function getMessageStatus(string $messageId): array
    {
        return $this->request('GET', '/api/v1/messages/' . rawurlencode($messageId));
    }

    public function getBatchStatus(string $batchId): array
    {
        return $this->request('GET', '/api/v1/batches/' . rawurlencode($batchId));
    }

    protected function request(string $method, string $path, ?array $body = null, ?int $timeoutOverride = null): array
    {
        if (!$this->isConfigured()) {
            throw new GatewayRejectedException(
                'Lopyta Mail Gateway belum dikonfigurasi (client_id atau client_secret kosong).',
                400,
                'not_configured'
            );
        }

        $url = $this->baseUrl . $path;
        $timeout = $timeoutOverride ?? $this->timeoutSeconds;
        $jsonBody = $body !== null ? json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) : null;

        $lastTransient = null;

        for ($attempt = 1; $attempt <= $this->inlineMaxAttempts; $attempt++) {
            try {
                [$status, $rawResponse] = $this->dispatchHttp($method, $url, $jsonBody, $timeout);
            } catch (TransientGatewayException $e) {
                $lastTransient = $e;
                if ($attempt < $this->inlineMaxAttempts) {
                    usleep($this->inlineDelayMs * 1000 * $attempt);
                    continue;
                }
                throw $lastTransient;
            }

            $decoded = $rawResponse !== '' ? json_decode($rawResponse, true) : [];
            if (!is_array($decoded)) {
                $decoded = [];
            }

            if ($status >= 200 && $status < 300) {
                return $decoded;
            }

            $msg = (string) ($decoded['error']['message'] ?? $decoded['message'] ?? substr($rawResponse, 0, 300) ?: "HTTP {$status}");
            $code = isset($decoded['error']['code']) ? (string) $decoded['error']['code'] : null;

            if ($status === 408 || $status === 429 || $status >= 500) {
                $lastTransient = new TransientGatewayException(
                    "Lopyta Gateway {$path} sementara tidak tersedia ({$status}): {$msg}",
                    $status
                );
                if ($attempt < $this->inlineMaxAttempts) {
                    usleep($this->inlineDelayMs * 1000 * $attempt);
                    continue;
                }
                throw $lastTransient;
            }

            throw new GatewayRejectedException(
                "Lopyta Gateway {$path} ditolak ({$status}): {$msg}",
                $status,
                $code
            );
        }

        throw $lastTransient ?? new TransientGatewayException("Request Lopyta Gateway {$path} gagal sementara.");
    }

    /**
     * @return array{0: int, 1: string}
     */
    protected function dispatchHttp(string $method, string $url, ?string $jsonBody, int $timeout): array
    {
        $headers = [
            'X-Client-Id: ' . $this->clientId,
            'X-Client-Secret: ' . $this->clientSecret,
            'Accept: application/json',
        ];
        if ($jsonBody !== null) {
            $headers[] = 'Content-Type: application/json';
        }

        if ($this->transport !== null) {
            return ($this->transport)($method, $url, $headers, $jsonBody, $timeout);
        }

        $ch = curl_init($url);
        if ($ch === false) {
            throw new TransientGatewayException('Gagal menginisialisasi cURL ke Lopyta Gateway.');
        }

        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
        ]);

        if ($jsonBody !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonBody);
        }

        $response = curl_exec($ch);
        if ($response === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new TransientGatewayException("Koneksi/timeout ke Lopyta Gateway gagal: {$err}");
        }

        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return [$status, (string) $response];
    }
}
