"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyWebhookSignature = verifyWebhookSignature;
exports.parseWebhookEvent = parseWebhookEvent;
const node_crypto_1 = require("node:crypto");
const errors_js_1 = require("./errors.js");
/**
 * Memverifikasi header X-Gateway-Signature ("sha256=<hex>") dari Lopyta Mail Gateway
 * secara timing-safe terhadap raw request body (jangan pakai JSON.stringify ulang).
 */
function verifyWebhookSignature(rawBody, signatureHeader, webhookSecret) {
    if (!webhookSecret || !signatureHeader) {
        return false;
    }
    const trimmedHeader = signatureHeader.trim();
    const payloadBuf = typeof rawBody === "string"
        ? Buffer.from(rawBody, "utf8")
        : Buffer.from(rawBody);
    const expected = `sha256=${(0, node_crypto_1.createHmac)("sha256", webhookSecret).update(payloadBuf).digest("hex")}`;
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(trimmedHeader, "utf8");
    if (a.length !== b.length) {
        return false;
    }
    return (0, node_crypto_1.timingSafeEqual)(a, b);
}
/**
 * Memverifikasi signature webhook lalu mem-parse JSON envelope dari Lopyta Gateway.
 */
function parseWebhookEvent(rawBody, signatureHeader, webhookSecret) {
    if (!verifyWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
        throw new errors_js_1.LopytaClientError("Signature webhook gateway tidak valid.", {
            statusCode: 403,
            code: "invalid_signature",
        });
    }
    const text = typeof rawBody === "string"
        ? rawBody
        : Buffer.from(rawBody).toString("utf8");
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (err) {
        throw new errors_js_1.LopytaClientError("Payload JSON webhook tidak valid.", {
            statusCode: 400,
            code: "invalid_json",
            cause: err,
        });
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.event !== "string") {
        throw new errors_js_1.LopytaClientError("Struktur payload webhook Lopyta tidak lengkap.", {
            statusCode: 400,
            code: "invalid_payload",
        });
    }
    return parsed;
}
