<?php

require_once __DIR__ . '/../src/Exceptions/TransientGatewayException.php';
require_once __DIR__ . '/../src/Exceptions/GatewayRejectedException.php';
require_once __DIR__ . '/../src/Client.php';
require_once __DIR__ . '/../src/WebhookVerifier.php';
require_once __DIR__ . '/../src/Queue/FileRetryQueue.php';

use Lopyta\MailGateway\Client;
use Lopyta\MailGateway\Exceptions\GatewayRejectedException;
use Lopyta\MailGateway\Exceptions\TransientGatewayException;
use Lopyta\MailGateway\Queue\FileRetryQueue;
use Lopyta\MailGateway\WebhookVerifier;

// 1. Test Client transient retry -> success, plus permanent 401
$calls = 0;
$client = new Client(
    'cli_php_test',
    'sec_php_test',
    'https://lopyta.com',
    30,
    2,
    50,
    function (string $method, string $url, array $headers, ?string $body) use (&$calls): array {
        $calls++;
        if ($calls === 1) {
            return [503, json_encode(['error' => ['message' => 'Maintenance']])];
        }
        return [202, json_encode(['success' => true, 'message_id' => 'm1', 'status' => 'queued'])];
    }
);

$res = $client->send(['to' => 'a@b.com', 'subject' => 'Hi', 'text' => 'Body']);
assert($res['message_id'] === 'm1' && $calls === 2, 'Inline retry must recover on attempt 2');

$authClient = new Client(
    'cli_php_test',
    'wrong',
    'https://lopyta.com',
    30,
    3,
    50,
    fn () => [401, json_encode(['error' => ['code' => 'unauthorized', 'message' => 'Invalid secret']])]
);
$caughtRejected = false;
try {
    $authClient->send(['to' => 'a@b.com', 'subject' => 'Hi', 'text' => 'Body']);
} catch (GatewayRejectedException $e) {
    $caughtRejected = ($e->httpStatus === 401);
}
assert($caughtRejected, '401 must throw GatewayRejectedException');

// 2. Test WebhookVerifier
$raw = json_encode(['delivery_id' => 'd1', 'event' => 'email.delivered', 'data' => ['recipient_email' => 'u@b.com']]);
$sig = 'sha256=' . hash_hmac('sha256', $raw, 'whsec_php');
assert(WebhookVerifier::verifySignature($raw, $sig, 'whsec_php') === true);
assert(WebhookVerifier::verifySignature($raw, 'sha256=bad', 'whsec_php') === false);
$parsed = WebhookVerifier::parse($raw, $sig, 'whsec_php');
assert($parsed['event'] === 'email.delivered');

// 3. Test FileRetryQueue FIFO 24h retry & recovery
$tmpFile = sys_get_temp_dir() . '/lopyta_php_queue_' . uniqid() . '.json';
$gatewayUp = false;
$sentSubjects = [];

$queueClient = new Client(
    'cli_php',
    'sec_php',
    'https://lopyta.com',
    30,
    1,
    50,
    function (string $method, string $url, array $headers, ?string $body) use (&$gatewayUp, &$sentSubjects): array {
        if (!$gatewayUp) {
            return [503, 'Maintenance'];
        }
        $payload = json_decode((string) $body, true);
        $sentSubjects[] = $payload['subject'];
        return [202, json_encode(['success' => true, 'message_id' => 'm-ok', 'status' => 'queued'])];
    }
);

try {
    $queue = new FileRetryQueue($queueClient, $tmpFile);
    $t0 = 1700000000;
    $queue->enqueueSend(['to' => '1@b.com', 'subject' => 'First', 'text' => '1'], 0, $t0);
    $queue->enqueueSend(['to' => '2@b.com', 'subject' => 'Second', 'text' => '2'], 0, $t0 + 1);

    $passFail = $queue->processDueJobs(20, $t0 + 2);
    assert($passFail['retried'] === 2 && $passFail['sent'] === 0);

    $gatewayUp = true;
    $passRecover = $queue->processDueJobs(20, $t0 + 30);
    assert($passRecover['sent'] === 2);
    assert($sentSubjects === ['First', 'Second'], 'FIFO oldest-first ordering must be preserved');
    assert($queue->stats()['pending'] === 0);

    // 24h expiry test
    $downQueue = new FileRetryQueue($queueClient, $tmpFile);
    $gatewayUp = false;
    $downQueue->enqueueSend(['to' => '3@b.com', 'subject' => 'Expired', 'text' => '3'], 0, $t0);
    $passExpired = $downQueue->processDueJobs(20, $t0 + 86401);
    assert($passExpired['failed'] === 1);
} finally {
    @unlink($tmpFile);
}

echo "OK: PHP Client, WebhookVerifier, and FileRetryQueue (FIFO + 24h retry) passed.\n";
