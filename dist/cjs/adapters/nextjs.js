"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchWebhookCallbacks = dispatchWebhookCallbacks;
exports.createNextWebhookHandler = createNextWebhookHandler;
const errors_js_1 = require("../errors.js");
const webhook_js_1 = require("../webhook.js");
async function dispatchWebhookCallbacks(eventPayload, callbacks) {
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
function createNextWebhookHandler(callbacks) {
    return async function POST(request) {
        try {
            const rawBody = await request.text();
            const signature = request.headers.get("x-gateway-signature");
            const parsed = (0, webhook_js_1.parseWebhookEvent)(rawBody, signature, callbacks.webhookSecret);
            await dispatchWebhookCallbacks(parsed, callbacks);
            return Response.json({ status: "processed", event: parsed.event }, { status: 200 });
        }
        catch (err) {
            if (err instanceof errors_js_1.LopytaClientError && err.statusCode) {
                return Response.json({ error: err.message }, { status: err.statusCode });
            }
            return Response.json({ error: err instanceof Error ? err.message : "Webhook processing error" }, { status: 500 });
        }
    };
}
