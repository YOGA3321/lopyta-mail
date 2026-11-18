import { createHmac, timingSafeEqual } from "node:crypto";
import { LopytaClientError } from "./errors.js";
import type { ParsedWebhookEvent } from "./types.js";

/**
 * Memverifikasi header X-Gateway-Signature ("sha256=<hex>") dari Lopyta Mail Gateway
 * secara timing-safe terhadap raw request body (jangan pakai JSON.stringify ulang).
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array | Buffer,
  signatureHeader: string | null | undefined,
  webhookSecret: string,
): boolean {
  if (!webhookSecret || !signatureHeader) {
    return false;
  }

  const trimmedHeader = signatureHeader.trim();
  const payloadBuf = typeof rawBody === "string"
    ? Buffer.from(rawBody, "utf8")
    : Buffer.from(rawBody);

  const expected = `sha256=${createHmac("sha256", webhookSecret).update(payloadBuf).digest("hex")}`;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(trimmedHeader, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Memverifikasi signature webhook lalu mem-parse JSON envelope dari Lopyta Gateway.
 */
export function parseWebhookEvent<T = Record<string, unknown>>(
  rawBody: string | Uint8Array | Buffer,
  signatureHeader: string | null | undefined,
  webhookSecret: string,
): ParsedWebhookEvent<T> {
  if (!verifyWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    throw new LopytaClientError("Signature webhook gateway tidak valid.", {
      statusCode: 403,
      code: "invalid_signature",
    });
  }

  const text = typeof rawBody === "string"
    ? rawBody
    : Buffer.from(rawBody).toString("utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new LopytaClientError("Payload JSON webhook tidak valid.", {
      statusCode: 400,
      code: "invalid_json",
      cause: err,
    });
  }

  if (!parsed || typeof parsed !== "object" || typeof (parsed as any).event !== "string") {
    throw new LopytaClientError("Struktur payload webhook Lopyta tidak lengkap.", {
      statusCode: 400,
      code: "invalid_payload",
    });
  }

  return parsed as ParsedWebhookEvent<T>;
}
