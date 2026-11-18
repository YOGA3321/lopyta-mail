# Lopyta Mail Gateway SDK (`lopyta-mail`)

SDK resmi, **antrean retry persisten hingga 24 jam**, dan verifikator webhook HMAC-SHA256 untuk **Lopyta Centralized Email Gateway** (`https://lopyta.com`).

Mendukung dua ekosistem sekaligus dalam satu repositori (zero runtime dependency):
- **Node.js / Next.js / Express / TypeScript** (`package.json` — ESM & CommonJS)
- **PHP 8.1+ Native & Laravel 10/11/12** (`composer.json` — PSR-4 + Auto-Discovery ServiceProvider)

---

## 1. Instalasi Node.js / Next.js / Express

Karena repo ini bersifat public, Anda dapat menginstalnya langsung lewat GitHub (tanpa perlu publish ke npm registry):

```bash
npm install https://github.com/YOGA3321/YOGA3321-lopyta-mail.git
```

atau melalui SSH:

```bash
npm install git+ssh://git@github.com:YOGA3321/YOGA3321-lopyta-mail.git
```

### Konfigurasi `.env`

```dotenv
LOPYTA_GATEWAY_URL=https://lopyta.com
LOPYTA_GATEWAY_CLIENT_ID=cli_...
LOPYTA_GATEWAY_CLIENT_SECRET=sec_...
LOPYTA_GATEWAY_WEBHOOK_SECRET=whsec_...
```

*(Prefix `SEO_GATEWAY_*` juga otomatis dikenali jika aplikasi Anda sudah memakai variabel tersebut.)*

### A. Pengiriman Langsung (Dengan Retry Kilat Inline)

```ts
import { LopytaMailClient } from "lopyta-mail";

const mail = LopytaMailClient.fromEnv();

// Email satuan -> membalas HTTP 202 (status: "queued")
await mail.send({
  to: { email: "penerima@example.com", name: "Budi" },
  subject: "Konfirmasi Pendaftaran",
  html: "<p>Halo Budi, pendaftaran berhasil.</p>",
});

// Broadcast massal hingga 25.000 penerima dalam 1 HTTP JSON request
await mail.broadcast({
  subject: "Pengumuman Resmi",
  html: "<p>Halo {{name}}, silakan cek portal.</p>",
  external_batch_id: "event-12",
  recipients: [
    { email: "satu@example.com", name: "Satu" },
    { email: "dua@example.com", name: "Dua" },
  ],
});
```

### B. Antrean Retry Persisten hingga 24 Jam (`LopytaMailQueue`)

Jika gateway `lopyta.com` sedang lag, terputus, atau maintenance, masukkan pengiriman ke `LopytaMailQueue`. Pekerjaan disimpan dengan urutan **FIFO (terlama ke terbaru)** dan di-retry bertahap hingga **24 jam**:
- **VPS / Server Node.js / Express:** gunakan `FileQueueStorage` (disimpan aman di disk via atomic rename).
- **Next.js Serverless / Multi-Instance:** gunakan `RedisQueueStorage` + cron endpoint setiap 1 menit.

```ts
import { FileQueueStorage, LopytaMailClient, LopytaMailQueue } from "lopyta-mail";

const client = LopytaMailClient.fromEnv();
export const mailQueue = new LopytaMailQueue(client, {
  storage: new FileQueueStorage({ filePath: "./storage/lopyta-mail-queue.json" }),
  maxAgeMs: 24 * 60 * 60 * 1000, // batas retry 24 jam
  onSent: (job, res) => console.log("Terkirim ke gateway:", job.id, res),
  onRetry: (job, err, delayMs) => console.warn(`Retry #${job.attempts} dlm ${delayMs}ms:`, err.message),
  onFailed: (job, err) => console.error("Gagal permanen:", job.id, err.message),
});

// Di server Express / Node worker:
mailQueue.start();

// Saat user daftar (non-blocking: langsung masuk antrean lokal & coba kirim):
await mailQueue.enqueueSend({
  to: "user@example.com",
  subject: "Selamat Datang",
  html: "<p>Akun Anda aktif.</p>",
});
```

Di environment Serverless / Vercel Cron (mis. `app/api/cron/mail-queue/route.ts`):

```ts
export async function GET() {
  const result = await mailQueue.processDueJobs();
  return Response.json(result);
}
```

### C. Menerima Webhook dari Gateway

**Next.js App Router (`app/api/webhooks/email-gateway/route.ts`):**

```ts
import { createNextWebhookHandler } from "lopyta-mail/nextjs";

export const POST = createNextWebhookHandler({
  webhookSecret: process.env.LOPYTA_GATEWAY_WEBHOOK_SECRET!,
  onEmailSent: async (data) => {
    console.log("SES menerima:", data.gateway_message_id, data.recipient_email);
  },
  onEmailDelivered: async (data) => {
    console.log("Terkirim ke inbox tujuan:", data.recipient_email);
  },
  onEmailFailed: async (data) => {
    console.error("Bounce/Gagal:", data.recipient_email, data.error_message);
  },
  onBatchCompleted: async (batch) => {
    console.log("Batch selesai:", batch.batch_id, batch.sent_count);
  },
});
```

**Express:**

```ts
import express from "express";
import { createExpressWebhookMiddleware } from "lopyta-mail/express";

app.post(
  "/v1/webhooks/email-gateway",
  express.raw({ type: "application/json" }),
  createExpressWebhookMiddleware({
    webhookSecret: process.env.LOPYTA_GATEWAY_WEBHOOK_SECRET!,
    onEvent: async (envelope) => {
      console.log(envelope.event, envelope.data);
    },
  }),
);
```

---

## 2. Instalasi PHP Native & Laravel (Composer)

Tambahkan repositori GitHub ini ke `composer.json` proyek PHP/Laravel Anda:

```json
{
  "repositories": [
    {
      "type": "vcs",
      "url": "https://github.com/YOGA3321/YOGA3321-lopyta-mail.git"
    }
  ]
}
```

Lalu jalankan:

```bash
composer require lopyta/mail-gateway:dev-main
```

### A. PHP Native + Antrean Retry File 24 Jam

```php
<?php
require __DIR__ . '/vendor/autoload.php';

use Lopyta\MailGateway\Client;
use Lopyta\MailGateway\Queue\FileRetryQueue;
use Lopyta\MailGateway\WebhookVerifier;

$client = Client::fromEnv();
$queue = new FileRetryQueue($client, __DIR__ . '/storage/mail-queue.json');

// Masukkan ke antrean persisten:
$queue->enqueueSend([
    'to' => ['email' => 'siswa@example.com', 'name' => 'Budi'],
    'subject' => 'Info Ujian',
    'html' => '<p>Jadwal ujian tersedia.</p>',
]);

// Jalankan dari cron tiap menit (php worker.php):
$summary = $queue->processDueJobs();

// Verifikasi webhook masuk di endpoint PHP Native:
$rawBody = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_GATEWAY_SIGNATURE'] ?? null;
$event = WebhookVerifier::parse($rawBody, $sig, getenv('LOPYTA_GATEWAY_WEBHOOK_SECRET'));
```

### B. Laravel (Auto-Discovery)

ServiceProvider otomatis mendaftarkan driver mailer `lopyta-gateway`, trait retry 24 jam, dan macro route webhook:

```php
// config/mail.php -> pastikan mailer tersedia atau set di .env:
// MAIL_MAILER=lopyta-gateway

// routes/web.php atau routes/api.php:
Route::lopytaWebhook('/v1/webhooks/email-gateway');

// Di Job / Queued Mailable agar otomatis retry hingga 24 jam saat gateway maintenance:
class SendWelcomeJob implements ShouldQueue
{
    use \Lopyta\MailGateway\Laravel\RetriesOnGatewayMaintenance;
}
```

---

## 3. Cara Melakukan Update SDK ke Versi Baru

1. Di folder `/home/yoga/mail-gateway`, setelah mengubah kode di `src/` atau `php/`:
   ```bash
   npm test
   ```
   *(Perintah `npm test` otomatis menjalankan `npm run build` agar folder `dist/` ikut diperbarui sebelum di-push.)*
2. Commit, buat tag versi baru (opsional namun disarankan), lalu push ke GitHub:
   ```bash
   git add .
   git commit -m "chore: update sdk v1.0.1"
   git tag v1.0.1
   git push origin main --tags
   ```
3. Di project **Next.js / Node.js** Anda, perbarui dependency dengan:
   ```bash
   npm update lopyta-mail
   # atau kunci ke tag rilis tertentu:
   npm install https://github.com/YOGA3321/YOGA3321-lopyta-mail.git#v1.0.1
   ```
4. Di project **PHP / Laravel**, perbarui dengan:
   ```bash
   composer update lopyta/mail-gateway
   ```

