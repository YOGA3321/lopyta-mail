import type { ParsedWebhookEvent, WebhookBatchEventData, WebhookEmailEventData } from "../types.js";
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
export declare function dispatchWebhookCallbacks(eventPayload: ParsedWebhookEvent<any>, callbacks: WebhookHandlerCallbacks): Promise<void>;
/**
 * Handler siap pakai untuk Next.js App Router (app/api/webhooks/email/route.ts):
 * `export const POST = createNextWebhookHandler({ webhookSecret: ..., onEmailDelivered: async (data) => ... });`
 */
export declare function createNextWebhookHandler(callbacks: WebhookHandlerCallbacks): (request: Request) => Promise<Response>;
