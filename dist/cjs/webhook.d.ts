import type { ParsedWebhookEvent } from "./types.js";
/**
 * Memverifikasi header X-Gateway-Signature ("sha256=<hex>") dari Lopyta Mail Gateway
 * secara timing-safe terhadap raw request body (jangan pakai JSON.stringify ulang).
 */
export declare function verifyWebhookSignature(rawBody: string | Uint8Array | Buffer, signatureHeader: string | null | undefined, webhookSecret: string): boolean;
/**
 * Memverifikasi signature webhook lalu mem-parse JSON envelope dari Lopyta Gateway.
 */
export declare function parseWebhookEvent<T = Record<string, unknown>>(rawBody: string | Uint8Array | Buffer, signatureHeader: string | null | undefined, webhookSecret: string): ParsedWebhookEvent<T>;
