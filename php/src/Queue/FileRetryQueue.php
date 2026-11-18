<?php

namespace Lopyta\MailGateway\Queue;

use Lopyta\MailGateway\Client;
use Lopyta\MailGateway\Exceptions\TransientGatewayException;

/**
 * Antrean FIFO berbasis file (dengan file lock flock) untuk aplikasi PHP Native tanpa Laravel.
 * Mendukung retry bertahap hingga 24 jam jika Lopyta Gateway lag atau terputus.
 */
class FileRetryQueue
{
    private const BACKOFF_SECONDS = [15, 30, 60, 120, 300, 600, 900, 1800, 3600];

    public function __construct(
        private readonly Client $client,
        private readonly string $filePath,
        private readonly int $maxAgeSeconds = 86400,
        private readonly int $maxAttempts = 35
    ) {}

    public function enqueueSend(array $payload, int $delaySeconds = 0, ?int $nowTs = null): string
    {
        return $this->enqueue('send', $payload, $delaySeconds, $nowTs);
    }

    public function enqueueBroadcast(array $payload, int $delaySeconds = 0, ?int $nowTs = null): string
    {
        return $this->enqueue('broadcast', $payload, $delaySeconds, $nowTs);
    }

    private function enqueue(string $kind, array $payload, int $delaySeconds, ?int $nowTs = null): string
    {
        $now = $nowTs ?? time();
        $id = bin2hex(random_bytes(16));

        $this->mutate(function (array $jobs) use ($id, $kind, $payload, $delaySeconds, $now): array {
            $jobs[] = [
                'id' => $id,
                'kind' => $kind,
                'payload' => $payload,
                'status' => 'pending',
                'attempts' => 0,
                'created_at' => $now,
                'updated_at' => $now,
                'next_attempt_at' => $now + max(0, $delaySeconds),
                'last_error' => null,
            ];
            return $jobs;
        });

        return $id;
    }

    /**
     * Memproses antrean yang sudah jatuh tempo secara FIFO (dari terlama ke terbaru).
     * Panggil fungsi ini lewat cron setiap menit (mis. php worker.php).
     *
     * @return array{sent: int, retried: int, failed: int}
     */
    public function processDueJobs(int $limit = 20, ?int $nowTs = null): array
    {
        $now = $nowTs ?? time();
        $claimed = $this->claimDue($limit, $now);

        $sent = 0;
        $retried = 0;
        $failed = 0;

        foreach ($claimed as $job) {
            $attempt = (int) $job['attempts'] + 1;
            try {
                if ($job['kind'] === 'send') {
                    $this->client->send($job['payload']);
                } else {
                    $this->client->broadcast($job['payload']);
                }
                $this->removeJob($job['id']);
                $sent++;
            } catch (\Throwable $e) {
                $age = $now - (int) $job['created_at'];
                $canRetry = $e instanceof TransientGatewayException
                    && $attempt < $this->maxAttempts
                    && $age < $this->maxAgeSeconds;

                if ($canRetry) {
                    $idx = min($attempt - 1, count(self::BACKOFF_SECONDS) - 1);
                    $delay = self::BACKOFF_SECONDS[$idx];
                    $nextAt = min($now + $delay, (int) $job['created_at'] + $this->maxAgeSeconds);
                    $this->rescheduleJob($job['id'], $nextAt, $attempt, $e->getMessage(), $now);
                    $retried++;
                } else {
                    $this->failJob($job['id'], $attempt, $e->getMessage(), $now);
                    $failed++;
                }
            }
        }

        return ['sent' => $sent, 'retried' => $retried, 'failed' => $failed];
    }

    /**
     * @return array{pending: int, processing: int, failed: int}
     */
    public function stats(): array
    {
        $jobs = $this->readAll();
        $stats = ['pending' => 0, 'processing' => 0, 'failed' => 0];
        foreach ($jobs as $job) {
            $st = $job['status'] ?? 'pending';
            if (isset($stats[$st])) {
                $stats[$st]++;
            }
        }
        return $stats;
    }

    private function claimDue(int $limit, int $now): array
    {
        $claimed = [];
        $this->mutate(function (array $jobs) use ($limit, $now, &$claimed): array {
            $dueIndices = [];
            foreach ($jobs as $idx => $job) {
                if (($job['status'] ?? '') === 'pending' && (int) ($job['next_attempt_at'] ?? 0) <= $now) {
                    $dueIndices[] = $idx;
                }
            }

            usort($dueIndices, fn (int $a, int $b) => ((int) $jobs[$a]['created_at']) <=> ((int) $jobs[$b]['created_at']));
            $selected = array_slice($dueIndices, 0, max(1, $limit));

            foreach ($selected as $idx) {
                $jobs[$idx]['status'] = 'processing';
                $jobs[$idx]['updated_at'] = $now;
                $claimed[] = $jobs[$idx];
            }

            return $jobs;
        });

        return $claimed;
    }

    private function removeJob(string $jobId): void
    {
        $this->mutate(fn (array $jobs) => array_values(array_filter($jobs, fn ($j) => ($j['id'] ?? '') !== $jobId)));
    }

    private function rescheduleJob(string $jobId, int $nextAt, int $attempts, string $error, int $now): void
    {
        $this->mutate(function (array $jobs) use ($jobId, $nextAt, $attempts, $error, $now): array {
            foreach ($jobs as &$j) {
                if (($j['id'] ?? '') === $jobId) {
                    $j['status'] = 'pending';
                    $j['attempts'] = $attempts;
                    $j['next_attempt_at'] = $nextAt;
                    $j['last_error'] = $error;
                    $j['updated_at'] = $now;
                }
            }
            return $jobs;
        });
    }

    private function failJob(string $jobId, int $attempts, string $error, int $now): void
    {
        $this->mutate(function (array $jobs) use ($jobId, $attempts, $error, $now): array {
            foreach ($jobs as &$j) {
                if (($j['id'] ?? '') === $jobId) {
                    $j['status'] = 'failed';
                    $j['attempts'] = $attempts;
                    $j['last_error'] = $error;
                    $j['updated_at'] = $now;
                }
            }
            return $jobs;
        });
    }

    private function readAll(): array
    {
        $dir = dirname($this->filePath);
        if (!is_dir($dir)) {
            return [];
        }
        if (!file_exists($this->filePath)) {
            return [];
        }
        $fp = fopen($this->filePath, 'r');
        if ($fp === false) {
            return [];
        }
        try {
            flock($fp, LOCK_SH);
            $content = stream_get_contents($fp);
            flock($fp, LOCK_UN);
            $decoded = $content ? json_decode($content, true) : [];
            return is_array($decoded) ? $decoded : [];
        } finally {
            fclose($fp);
        }
    }

    /**
     * @param callable(array): array $mutator
     */
    private function mutate(callable $mutator): void
    {
        $dir = dirname($this->filePath);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $fp = fopen($this->filePath, 'c+');
        if ($fp === false) {
            throw new \RuntimeException("Tidak dapat membuka file antrean {$this->filePath}");
        }

        try {
            flock($fp, LOCK_EX);
            $raw = stream_get_contents($fp);
            $jobs = $raw ? json_decode($raw, true) : [];
            if (!is_array($jobs)) {
                $jobs = [];
            }
            $updated = $mutator($jobs);
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode(array_values($updated), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            fflush($fp);
            flock($fp, LOCK_UN);
        } finally {
            fclose($fp);
        }
    }
}
