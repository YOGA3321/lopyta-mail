# Lopyta Mail Gateway SDK (`lopyta-mail`)

Official SDK, **persistent 24-hour FIFO retry queue**, and **HMAC-SHA256 webhook verifier** for **Lopyta Centralized Email Gateway**.

Built with zero external runtime dependencies for both ecosystems in a single repository:
- **Node.js / TypeScript / Next.js / Express** (`package.json` — Dual ESM & CommonJS + `.d.ts` declarations)
- **PHP 8.1+ Native & Laravel 10 / 11 / 12 / 13** (`composer.json` — PSR-4 + Laravel Auto-Discovery)

---

## Features

- **Zero Runtime Dependencies:** Uses native Node.js 18+ (`fetch`, `node:crypto`, `node:fs/promises`) and native PHP 8.1+ (`ext-curl`, `ext-json`, `hash_hmac`).
- **Inline Fast Retry + Error Classification:** Automatically retries transient network blips / `408` / `429` / `5xx` responses, while failing fast on permanent `4xx` errors (`LopytaClientError` / `GatewayRejectedException`).
- **Durable 24-Hour Retry Queue (FIFO):** Built-in client-side queue (`LopytaMailQueue` for Node.js and `FileRetryQueue` for PHP) keeps emails in FIFO order with progressive backoff up to 24 hours whenever the gateway is temporarily unreachable or undergoing maintenance.
- **Bulk Broadcast Support:** Send personalized broadcasts to up to 25,000 recipients in a single HTTP request (and auto-chunk larger lists).
- **Verified Webhooks:** Timing-safe `X-Gateway-Signature` verification with ready-to-use adapters for Next.js App Router, Express, PHP, and Laravel.

---

## 1. Node.js / Next.js / TypeScript

### Installation

Install directly from GitHub via HTTPS:

```bash
npm install https://github.com/YOGA3321/lopyta-mail.git
```

Or pin a specific release tag (recommended for production):

```bash
npm install https://github.com/YOGA3321/lopyta-mail.git#v1.0.1
```

### Environment Variables

```dotenv
LOPYTA_GATEWAY_URL=https://lopyta.com
LOPYTA_GATEWAY_CLIENT_ID=cli_...
LOPYTA_GATEWAY_CLIENT_SECRET=sec_...
LOPYTA_GATEWAY_WEBHOOK_SECRET=whsec_...
```

### Quick Start (Direct Send & Bulk Broadcast)

```ts
import { LopytaMailClient } from "lopyta-mail";

const mail = LopytaMailClient.fromEnv();

// 1. Send a single transactional email (returns 202 queued)
const single = await mail.send({
  to: { email: "recipient@example.com", name: "Alex" },
  subject: "Welcome to Lopyta",
  html: "<p>Hello Alex, your account is ready.</p>",
  text: "Hello Alex, your account is ready.",
  external_id: "welcome-101",
});

// 2. Send a personalized bulk broadcast (1 HTTP JSON request up to 25,000 recipients)
const batch = await mail.broadcast({
  subject: "Monthly Update",
  html: "<p>Hi {{name}}, check out our latest news.</p>",
  external_batch_id: "newsletter-2026-11",
  recipients: [
    { email: "one@example.com", name: "One", variables: { name: "One" } },
    { email: "two@example.com", name: "Two", variables: { name: "Two" } },
  ],
});

// 3. Check client quota & global gateway rate limits
const usage = await mail.usage();
```

### Durable 24-Hour Retry Queue (`LopytaMailQueue`)

Queue outbound requests locally so your app never blocks user requests or drops mail during transient gateway downtime:

- **`FileQueueStorage`**: Atomic file-backed persistence for single-server Node.js / Express / Docker apps (survives process restarts without Redis).
- **`RedisQueueStorage`**: Shared state for Next.js / multi-instance / serverless deployments (accepts `ioredis`, `node-redis`, or Upstash clients).
- **`MemoryQueueStorage`**: Ephemeral in-memory queue for scripts and tests.

```ts
import {
  FileQueueStorage,
  LopytaMailClient,
  LopytaMailQueue,
} from "lopyta-mail";

const client = LopytaMailClient.fromEnv();

export const mailQueue = new LopytaMailQueue(client, {
  storage: new FileQueueStorage({ filePath: "./storage/lopyta-mail-queue.json" }),
  maxAgeMs: 24 * 60 * 60 * 1000, // Retry transient failures up to 24 hours
  onSent: (job, res) => console.log("Accepted by gateway:", job.id, res),
  onRetry: (job, err, delayMs) =>
    console.warn(`Retry #${job.attempts} scheduled in ${delayMs}ms: ${err.message}`),
  onFailed: (job, err) => console.error("Permanent failure:", job.id, err.message),
});

// Option A: Background polling on a long-running Node.js / Express server
mailQueue.start();

// Non-blocking enqueue
await mailQueue.enqueueSend({
  to: "user@example.com",
  subject: "Order Confirmed",
  html: "<p>Thank you for your order.</p>",
});

// Option B: Trigger manually from a Serverless Cron endpoint (e.g. every 1 minute)
const stats = await mailQueue.processDueJobs();
```

### Receiving Webhooks

#### Next.js App Router (`app/api/webhooks/email-gateway/route.ts`)

```ts
import { createNextWebhookHandler } from "lopyta-mail/nextjs";

export const POST = createNextWebhookHandler({
  webhookSecret: process.env.LOPYTA_GATEWAY_WEBHOOK_SECRET!,
  onEmailSent: async (data) => {
    console.log("Sent via SES:", data.gateway_message_id, data.recipient_email);
  },
  onEmailDelivered: async (data) => {
    console.log("Delivered:", data.gateway_message_id, data.recipient_email);
  },
  onEmailFailed: async (data) => {
    console.error("Failed/Bounced:", data.recipient_email, data.error_message);
  },
  onBatchProgress: async (batch) => {
    console.log(`Batch ${batch.batch_id}: ${batch.sent_count}/${batch.total_recipients}`);
  },
  onBatchCompleted: async (batch) => {
    console.log("Batch completed:", batch.batch_id, batch.status);
  },
});
```

#### Express

```ts
import express from "express";
import { createExpressWebhookMiddleware } from "lopyta-mail/express";

const app = express();

app.post(
  "/v1/webhooks/email-gateway",
  express.raw({ type: "application/json" }),
  createExpressWebhookMiddleware({
    webhookSecret: process.env.LOPYTA_GATEWAY_WEBHOOK_SECRET!,
    onEvent: async (envelope) => {
      console.log(envelope.event, envelope.delivery_id, envelope.data);
    },
  }),
);
```

---

## 2. PHP Native & Laravel (Composer)

### Installation

Add the GitHub repository to your project's `composer.json`:

```json
{
  "repositories": [
    {
      "type": "vcs",
      "url": "https://github.com/YOGA3321/lopyta-mail.git"
    }
  ]
}
```

Then require the stable package release:

```bash
composer require lopyta/mail-gateway:^1.0
```

### A. PHP Native Usage (Client + Durable File Queue + Webhook Verifier)

```php
<?php

require __DIR__ . '/vendor/autoload.php';

use Lopyta\MailGateway\Client;
use Lopyta\MailGateway\Queue\FileRetryQueue;
use Lopyta\MailGateway\WebhookVerifier;

$client = Client::fromEnv();
$queue = new FileRetryQueue($client, __DIR__ . '/storage/lopyta-mail-queue.json');

// 1. Direct send
$client->send([
    'to' => ['email' => 'user@example.com', 'name' => 'Alex'],
    'subject' => 'Verification Code',
    'html' => '<p>Your code is <strong>123456</strong>.</p>',
]);

// 2. Persistent FIFO queue (retries up to 24 hours on gateway maintenance/timeout)
$queue->enqueueSend([
    'to' => 'user@example.com',
    'subject' => 'Receipt',
    'text' => 'Thank you for your payment.',
]);

// Run inside a 1-minute cron worker (e.g. `php worker.php`):
$result = $queue->processDueJobs();

// 3. Verify incoming webhook in your webhook endpoint
$rawBody = file_get_contents('php://input') ?: '';
$signature = $_SERVER['HTTP_X_GATEWAY_SIGNATURE'] ?? null;
$event = WebhookVerifier::parse($rawBody, $signature, getenv('LOPYTA_GATEWAY_WEBHOOK_SECRET') ?: '');
```

### B. Laravel Integration (Auto-Discovery)

The package auto-discovers `Lopyta\MailGateway\Laravel\LopytaGatewayServiceProvider` and registers the `lopyta-gateway` mail driver automatically.

1. Configure `.env`:

   ```dotenv
   MAIL_MAILER=lopyta-gateway
   LOPYTA_GATEWAY_URL=https://lopyta.com
   LOPYTA_GATEWAY_CLIENT_ID=cli_...
   LOPYTA_GATEWAY_CLIENT_SECRET=sec_...
   LOPYTA_GATEWAY_WEBHOOK_SECRET=whsec_...
   ```

2. Add the mailer entry in `config/mail.php`:

   ```php
   'mailers' => [
       'lopyta-gateway' => [
           'transport' => 'lopyta-gateway',
       ],
   ],
   ```

3. Use standard Laravel `Mail`:

   ```php
   Mail::to('user@example.com')->send(new WelcomeMail());
   Mail::to('user@example.com')->queue(new WelcomeMail());
   ```

4. Add the 24-hour retry trait to queued Jobs or Mailables:

   ```php
   use Illuminate\Contracts\Queue\ShouldQueue;
   use Lopyta\MailGateway\Laravel\RetriesOnGatewayMaintenance;

   class SendNotificationJob implements ShouldQueue
   {
       use RetriesOnGatewayMaintenance;
   }
   ```

5. Mount the built-in CSRF-exempt signed webhook endpoint & listen to `GatewayWebhookReceived`:

   ```php
   // routes/web.php
   Route::lopytaWebhook('/v1/webhooks/email-gateway');
   ```

   ```php
   use Illuminate\Support\Facades\Event;
   use Lopyta\MailGateway\Laravel\Events\GatewayWebhookReceived;

   Event::listen(GatewayWebhookReceived::class, function (GatewayWebhookReceived $webhook) {
       // $webhook->event: 'email.sent', 'email.delivered', 'email.bounced', 'batch.completed', etc.
       // $webhook->data: payload details including gateway_message_id & recipient_email
   });
   ```

---

## Webhook Events Reference

| Event | Trigger |
| --- | --- |
| `email.sent` | Email accepted by AWS SES |
| `email.delivered` | Delivery confirmed via AWS SNS |
| `email.bounced` | Bounced by recipient mail server |
| `email.complained` | Recipient marked as spam |
| `email.rejected` | Rejected by AWS SES |
| `email.delayed` | Temporary delivery delay reported by SES |
| `email.failed` | Permanent gateway failure after retries exhausted |
| `batch.progress` | Periodic progress update (every 25 processed recipients) |
| `batch.completed` | Bulk broadcast batch finished |

---

## License

MIT
