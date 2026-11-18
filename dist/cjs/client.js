"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LopytaMailClient = void 0;
const errors_js_1 = require("./errors.js");
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
class LopytaMailClient {
    baseUrl;
    clientId;
    clientSecret;
    timeoutMs;
    inlineMaxAttempts;
    inlineInitialDelayMs;
    inlineMaxDelayMs;
    fetchFn;
    constructor(config) {
        const base = (config.baseUrl ?? "https://lopyta.com").trim().replace(/\/+$/, "");
        if (!base) {
            throw new errors_js_1.LopytaClientError("baseUrl gateway tidak boleh kosong.");
        }
        if (!config.clientId?.trim() || !config.clientSecret?.trim()) {
            throw new errors_js_1.LopytaClientError("clientId dan clientSecret wajib diisi.");
        }
        this.baseUrl = base;
        this.clientId = config.clientId.trim();
        this.clientSecret = config.clientSecret.trim();
        this.timeoutMs = Math.max(1000, config.timeoutMs ?? 30_000);
        this.inlineMaxAttempts = Math.max(1, config.inlineRetry?.maxAttempts ?? 2);
        this.inlineInitialDelayMs = Math.max(50, config.inlineRetry?.initialDelayMs ?? 400);
        this.inlineMaxDelayMs = Math.max(this.inlineInitialDelayMs, config.inlineRetry?.maxDelayMs ?? 3000);
        this.fetchFn = config.fetchFn ?? globalThis.fetch;
        if (typeof this.fetchFn !== "function") {
            throw new errors_js_1.LopytaClientError("fetch API tidak tersedia. Gunakan Node.js 18+ atau sediakan fetchFn.");
        }
    }
    /**
     * Membuat client langsung dari environment variables (.env).
     * Mendukung prefix LOPYTA_GATEWAY_* maupun SEO_GATEWAY_*.
     */
    static fromEnv(env = process.env) {
        const baseUrl = env.LOPYTA_GATEWAY_URL || env.SEO_GATEWAY_URL || "https://lopyta.com";
        const clientId = env.LOPYTA_GATEWAY_CLIENT_ID || env.SEO_GATEWAY_CLIENT_ID || "";
        const clientSecret = env.LOPYTA_GATEWAY_CLIENT_SECRET || env.SEO_GATEWAY_CLIENT_SECRET || "";
        const timeoutRaw = Number(env.LOPYTA_GATEWAY_TIMEOUT_MS || env.SEO_GATEWAY_TIMEOUT_MS || "30000");
        return new LopytaMailClient({
            baseUrl,
            clientId,
            clientSecret,
            timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 30_000,
        });
    }
    /** Mengirim 1 email transaksional ke POST /api/v1/send (dikembalikan status queued / 202). */
    async send(input) {
        return this.request("POST", "/api/v1/send", input);
    }
    /**
     * Mengirim broadcast massal hingga 25.000 penerima per 1 HTTP JSON request ke POST /api/v1/broadcast.
     * Jika penerima melebihi 25.000, otomatis dipecah menjadi beberapa chunk batch.
     */
    async broadcast(input) {
        const responses = await this.broadcastChunked(input);
        if (responses.length === 1) {
            return responses[0];
        }
        const totalAccepted = responses.reduce((sum, r) => sum + (r.accepted_count ?? 0), 0);
        const totalSkipped = responses.reduce((sum, r) => sum + (r.skipped_invalid_count ?? 0), 0);
        return {
            ...responses[0],
            accepted_count: totalAccepted,
            skipped_invalid_count: totalSkipped,
        };
    }
    async broadcastChunked(input, chunkSize = 25_000) {
        const maxPerChunk = Math.max(1, Math.min(25_000, chunkSize));
        if (!input.recipients?.length) {
            throw new errors_js_1.LopytaClientError("recipients broadcast tidak boleh kosong.", {
                statusCode: 400,
                code: "bad_request",
            });
        }
        if (input.recipients.length <= maxPerChunk) {
            return [await this.request("POST", "/api/v1/broadcast", input)];
        }
        const results = [];
        for (let i = 0; i < input.recipients.length; i += maxPerChunk) {
            const part = Math.floor(i / maxPerChunk) + 1;
            const chunkRecipients = input.recipients.slice(i, i + maxPerChunk);
            const extBatch = input.external_batch_id
                ? `${input.external_batch_id}-part-${part}`
                : undefined;
            const res = await this.request("POST", "/api/v1/broadcast", {
                ...input,
                external_batch_id: extBatch,
                recipients: chunkRecipients,
            });
            results.push(res);
        }
        return results;
    }
    /** Mengambil profil client & alamat sender default dari GET /api/v1/me. */
    async me() {
        const res = await this.request("GET", "/api/v1/me");
        return res.client;
    }
    /** Mengambil pemakaian kuota & rate limit global dari GET /api/v1/usage. */
    async usage() {
        return this.request("GET", "/api/v1/usage");
    }
    /** Mengecek status 1 email berdasarkan message_id. */
    async getMessageStatus(messageId) {
        return this.request("GET", `/api/v1/messages/${encodeURIComponent(messageId)}`);
    }
    /** Mengecek progres batch broadcast berdasarkan batch_id. */
    async getBatchStatus(batchId) {
        return this.request("GET", `/api/v1/batches/${encodeURIComponent(batchId)}`);
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        let lastTransient = null;
        for (let attempt = 1; attempt <= this.inlineMaxAttempts; attempt++) {
            const controller = new AbortController();
            const effectiveTimeout = path === "/api/v1/broadcast"
                ? Math.max(this.timeoutMs, 60_000)
                : this.timeoutMs;
            const timer = setTimeout(() => controller.abort(), effectiveTimeout);
            try {
                const res = await this.fetchFn(url, {
                    method,
                    headers: {
                        "X-Client-Id": this.clientId,
                        "X-Client-Secret": this.clientSecret,
                        Accept: "application/json",
                        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
                    },
                    body: body !== undefined ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                });
                const text = await res.text();
                let json = null;
                if (text) {
                    try {
                        json = JSON.parse(text);
                    }
                    catch {
                        json = null;
                    }
                }
                if (res.ok) {
                    return (json ?? {});
                }
                const errMessage = json?.error?.message ||
                    json?.message ||
                    text.slice(0, 300) ||
                    `HTTP ${res.status}`;
                const errCode = typeof json?.error?.code === "string" ? json.error.code : undefined;
                if (res.status === 408 || res.status === 429 || res.status >= 500) {
                    lastTransient = new errors_js_1.LopytaTransientError(`Lopyta Gateway ${path} sementara gagal (${res.status}): ${errMessage}`, { statusCode: res.status, code: errCode });
                    if (attempt < this.inlineMaxAttempts) {
                        await sleep(this.computeInlineBackoffMs(attempt));
                        continue;
                    }
                    throw lastTransient;
                }
                throw new errors_js_1.LopytaClientError(`Lopyta Gateway ${path} ditolak (${res.status}): ${errMessage}`, { statusCode: res.status, code: errCode });
            }
            catch (err) {
                if (err instanceof errors_js_1.LopytaClientError) {
                    throw err;
                }
                if (err instanceof errors_js_1.LopytaTransientError) {
                    throw err;
                }
                const isAbort = err instanceof Error && err.name === "AbortError";
                const detail = err instanceof Error ? err.message : String(err);
                lastTransient = new errors_js_1.LopytaTransientError(isAbort
                    ? `Koneksi ke Lopyta Gateway (${path}) timeout setelah ${effectiveTimeout}ms.`
                    : `Gagal menghubungi Lopyta Gateway (${path}): ${detail}`, { cause: err });
                if (attempt < this.inlineMaxAttempts) {
                    await sleep(this.computeInlineBackoffMs(attempt));
                    continue;
                }
                throw lastTransient;
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw lastTransient ?? new errors_js_1.LopytaTransientError(`Request ${path} gagal sementara.`);
    }
    computeInlineBackoffMs(attempt) {
        const base = Math.min(this.inlineMaxDelayMs, this.inlineInitialDelayMs * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * Math.min(200, base * 0.25));
        return base + jitter;
    }
}
exports.LopytaMailClient = LopytaMailClient;
