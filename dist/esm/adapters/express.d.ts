import { type WebhookHandlerCallbacks } from "./nextjs.js";
export interface ExpressLikeRequest {
    body?: unknown;
    rawBody?: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
}
export interface ExpressLikeResponse {
    status(code: number): ExpressLikeResponse;
    json(payload: unknown): void;
}
/**
 * Middleware Express untuk menerima webhook dari Lopyta Gateway.
 * Pasangkan dengan `express.raw({ type: "application/json" })` pada route webhook.
 */
export declare function createExpressWebhookMiddleware(callbacks: WebhookHandlerCallbacks): (req: ExpressLikeRequest, res: ExpressLikeResponse) => Promise<void>;
