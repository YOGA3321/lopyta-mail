"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExpressWebhookMiddleware = createExpressWebhookMiddleware;
const errors_js_1 = require("../errors.js");
const webhook_js_1 = require("../webhook.js");
const nextjs_js_1 = require("./nextjs.js");
/**
 * Middleware Express untuk menerima webhook dari Lopyta Gateway.
 * Pasangkan dengan `express.raw({ type: "application/json" })` pada route webhook.
 */
function createExpressWebhookMiddleware(callbacks) {
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
            const parsed = (0, webhook_js_1.parseWebhookEvent)(rawBody, signature, callbacks.webhookSecret);
            await (0, nextjs_js_1.dispatchWebhookCallbacks)(parsed, callbacks);
            res.status(200).json({ status: "processed", event: parsed.event });
        }
        catch (err) {
            if (err instanceof errors_js_1.LopytaClientError && err.statusCode) {
                res.status(err.statusCode).json({ error: err.message });
                return;
            }
            res.status(500).json({
                error: err instanceof Error ? err.message : "Webhook processing error",
            });
        }
    };
}
