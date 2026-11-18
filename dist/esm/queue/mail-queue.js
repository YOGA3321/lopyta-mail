import { randomUUID } from "node:crypto";
import { isRetryableGatewayError } from "../errors.js";
import { MemoryQueueStorage } from "./memory-storage.js";
const DEFAULT_BACKOFF_SCHEDULE_MS = [
    15_000, // 15 dtk
    30_000, // 30 dtk
    60_000, // 1 mnt
    120_000, // 2 mnt
    300_000, // 5 mnt
    600_000, // 10 mnt
    900_000, // 15 mnt
    1_800_000, // 30 mnt
    3_600_000, // 1 jam (berulang hingga batas 24 jam)
];
/**
 * Antrean client-side FIFO dengan retry otomatis hingga 24 jam.
 * Menjamin pengiriman dari Node.js / Next.js tetap aman dan berurutan dari yang paling lama
 * apabila gateway lopyta.com mengalami lag, timeout, atau maintenance sementara.
 */
export class LopytaMailQueue {
    client;
    storage;
    maxAgeMs;
    maxAttempts;
    backoffScheduleMs;
    batchProcessLimit;
    pollIntervalMs;
    onSent;
    onRetry;
    onFailed;
    timer = null;
    activeFlush = null;
    constructor(client, options = {}) {
        this.client = client;
        this.storage = options.storage ?? new MemoryQueueStorage();
        this.maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
        this.maxAttempts = Math.max(1, options.maxAttempts ?? 35);
        this.backoffScheduleMs = options.backoffScheduleMs?.length
            ? options.backoffScheduleMs
            : DEFAULT_BACKOFF_SCHEDULE_MS;
        this.batchProcessLimit = Math.max(1, options.batchProcessLimit ?? 20);
        this.pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 5000);
        this.onSent = options.onSent;
        this.onRetry = options.onRetry;
        this.onFailed = options.onFailed;
    }
    /**
     * Memasukkan pengiriman 1 email ke antrean dan memicu pengiriman latar secara non-blocking.
     */
    async enqueueSend(payload, opts = {}) {
        return this.enqueueInternal("send", payload, opts);
    }
    /**
     * Memasukkan pengiriman broadcast batch ke antrean agar tetap ter-retry hingga 24 jam bila gateway down.
     */
    async enqueueBroadcast(payload, opts = {}) {
        return this.enqueueInternal("broadcast", payload, opts);
    }
    async enqueueInternal(kind, payload, opts) {
        const now = Date.now();
        const job = {
            id: opts.id ?? randomUUID(),
            kind,
            payload,
            status: "pending",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
            nextAttemptAt: now + Math.max(0, opts.delayMs ?? 0),
        };
        await this.storage.enqueue(job);
        if (opts.processNow !== false && (opts.delayMs ?? 0) <= 0) {
            queueMicrotask(() => {
                void this.processDueJobs();
            });
        }
        return job;
    }
    /** Memulai worker polling otomatis di server Node.js/Express. */
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            void this.processDueJobs();
        }, this.pollIntervalMs);
        if (typeof this.timer.unref === "function") {
            this.timer.unref();
        }
    }
    /** Menghentikan timer polling latar. */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    /**
     * Memproses pekerjaan yang jatuh tempo (urutan FIFO dari terlama ke terbaru).
     * Dapat dipanggil langsung oleh endpoint Cron Next.js / Serverless setiap menit.
     */
    async processDueJobs(nowMs = Date.now()) {
        if (this.activeFlush) {
            return this.activeFlush;
        }
        this.activeFlush = this.runFlush(nowMs).finally(() => {
            this.activeFlush = null;
        });
        return this.activeFlush;
    }
    async runFlush(nowMs) {
        let sent = 0;
        let retried = 0;
        let failed = 0;
        while (true) {
            const dueJobs = await this.storage.claimDue(nowMs, this.batchProcessLimit);
            if (dueJobs.length === 0) {
                break;
            }
            for (const job of dueJobs) {
                const nextAttempt = job.attempts + 1;
                try {
                    const response = job.kind === "send"
                        ? await this.client.send(job.payload)
                        : await this.client.broadcast(job.payload);
                    await this.storage.markCompleted(job.id);
                    sent++;
                    if (this.onSent) {
                        await this.onSent({ ...job, attempts: nextAttempt }, response);
                    }
                }
                catch (rawErr) {
                    const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));
                    const ageMs = nowMs - job.createdAt;
                    const canRetry = isRetryableGatewayError(err) &&
                        nextAttempt < this.maxAttempts &&
                        ageMs < this.maxAgeMs;
                    if (canRetry) {
                        const idx = Math.min(nextAttempt - 1, this.backoffScheduleMs.length - 1);
                        const delayMs = this.backoffScheduleMs[idx];
                        const cappedNextAt = Math.min(nowMs + delayMs, job.createdAt + this.maxAgeMs);
                        await this.storage.reschedule(job.id, cappedNextAt, nextAttempt, err.message);
                        retried++;
                        if (this.onRetry) {
                            await this.onRetry({ ...job, attempts: nextAttempt, nextAttemptAt: cappedNextAt }, err, Math.max(0, cappedNextAt - nowMs));
                        }
                    }
                    else {
                        await this.storage.markFailed(job.id, nextAttempt, err.message);
                        failed++;
                        if (this.onFailed) {
                            await this.onFailed({ ...job, status: "failed", attempts: nextAttempt, lastError: err.message }, err);
                        }
                    }
                }
            }
            if (dueJobs.length < this.batchProcessLimit) {
                break;
            }
            nowMs = Date.now();
        }
        return { sent, retried, failed };
    }
    async stats(nowMs = Date.now()) {
        return this.storage.getStats(nowMs);
    }
    async listFailed(limit = 100) {
        return this.storage.listFailed(limit);
    }
    async retryFailedJob(jobId) {
        return this.storage.retryFailed(jobId);
    }
}
