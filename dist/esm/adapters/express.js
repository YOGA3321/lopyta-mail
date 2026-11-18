import { LopytaClientError } from "../errors.js";
import { parseWebhookEvent } from "../webhook.js";
import { dispatchWebhookCallbacks } from "./nextjs.js";
/**
 * Middleware Express untuk menerima webhook dari Lopyta Gateway.
 * Pasangkan dengan `express.raw({ type: "application/json" })` pada route webhook.
 */
export function createExpressWebhookMiddleware(callbacks) {
    return async function lopytaWebhookMiddleware(req, res) {
        try {
            const rawBody = Buffer.isBuffer(req.body) || typeof req.body === "string"
                ? req.body
                : req.rawBody;
            if (rawBody === undefined) {
                res.status(400).json({
                    error: "Raw body tidak ditemukan. Gunakan express.raw({ type: 'application/json' }) pada route ini.",
                });
                return;
            }
            const rawSig = req.headers["x-gateway-signature"];
            const signature = Array.isArray(rawSig) ? rawSig[0] : rawSig;
            const parsed = parseWebhookEvent(rawBody, signature, callbacks.webhookSecret);
            await dispatchWebhookCallbacks(parsed, callbacks);
            res.status(200).json({ status: "processed", event: parsed.event });
        }
        catch (err) {
            if (err instanceof LopytaClientError && err.statusCode) {
                res.status(err.statusCode).json({ error: err.message });
                return;
            }
            res.status(500).json({
                error: err instanceof Error ? err.message : "Webhook processing error",
            });
        }
    };
}
