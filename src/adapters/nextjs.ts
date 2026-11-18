import { LopytaClientError } from "../errors.js";
import type {
  ParsedWebhookEvent,
  WebhookBatchEventData,
  WebhookEmailEventData,
} from "../types.js";
import { parseWebhookEvent } from "../webhook.js";

export interface WebhookHandlerCallbacks {
  /** Wajib diisi dengan SEO_GATEWAY_WEBHOOK_SECRET client Anda. */
  webhookSecret: string;
  /** Dipanggil untuk SEMUA event webhook yang lolos verifikasi HMAC. */
  onEvent?: (payload: ParsedWebhookEvent<any>) => void | Promise<void>;
  onEmailSent?: (data: WebhookEmailEventData, envelope: ParsedWebhookEvent<WebhookEmailEventData>) => void | Promise<void>;
  onEmailDelivered?: (data: WebhookEmailEventData, envelope: ParsedWebhookEvent<WebhookEmailEventData>) => void | Promise<void>;
  onEmailFailed?: (data: WebhookEmailEventData, envelope: ParsedWebhookEvent<WebhookEmailEventData>) => void | Promise<void>;
  onBatchProgress?: (data: WebhookBatchEventData, envelope: ParsedWebhookEvent<WebhookBatchEventData>) => void | Promise<void>;
  onBatchCompleted?: (data: WebhookBatchEventData, envelope: ParsedWebhookEvent<WebhookBatchEventData>) => void | Promise<void>;
}

export async function dispatchWebhookCallbacks(
  eventPayload: ParsedWebhookEvent<any>,
  callbacks: WebhookHandlerCallbacks,
): Promise<void> {
  if (callbacks.onEvent) {
    await callbacks.onEvent(eventPayload);
  }

  switch (eventPayload.event) {
    case "email.sent":
      if (callbacks.onEmailSent) {
        await callbacks.onEmailSent(eventPayload.data, eventPayload);
      }
      break;
    case "email.delivered":
      if (callbacks.onEmailDelivered) {
        await callbacks.onEmailDelivered(eventPayload.data, eventPayload);
      }
      break;
    case "email.bounced":
    case "email.complained":
    case "email.rejected":
    case "email.failed":
      if (callbacks.onEmailFailed) {
        await callbacks.onEmailFailed(eventPayload.data, eventPayload);
      }
      break;
    case "batch.progress":
      if (callbacks.onBatchProgress) {
        await callbacks.onBatchProgress(eventPayload.data, eventPayload);
      }
      break;
    case "batch.completed":
      if (callbacks.onBatchCompleted) {
        await callbacks.onBatchCompleted(eventPayload.data, eventPayload);
      }
      break;
  }
}

/**
 * Handler siap pakai untuk Next.js App Router (app/api/webhooks/email/route.ts):
 * `export const POST = createNextWebhookHandler({ webhookSecret: ..., onEmailDelivered: async (data) => ... });`
 */
export function createNextWebhookHandler(callbacks: WebhookHandlerCallbacks) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const rawBody = await request.text();
      const signature = request.headers.get("x-gateway-signature");
      const parsed = parseWebhookEvent(rawBody, signature, callbacks.webhookSecret);
      await dispatchWebhookCallbacks(parsed, callbacks);

      return Response.json({ status: "processed", event: parsed.event }, { status: 200 });
    } catch (err) {
      if (err instanceof LopytaClientError && err.statusCode) {
        return Response.json({ error: err.message }, { status: err.statusCode });
      }
      return Response.json(
        { error: err instanceof Error ? err.message : "Webhook processing error" },
        { status: 500 },
      );
    }
  };
}
