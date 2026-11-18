import type { LopytaMailClient } from "../client.js";
import type { BroadcastEmailInput, SendEmailInput } from "../types.js";
import type { LopytaMailQueueOptions, QueueJob, QueueStats } from "./types.js";
/**
 * Antrean client-side FIFO dengan retry otomatis hingga 24 jam.
 * Menjamin pengiriman dari Node.js / Next.js tetap aman dan berurutan dari yang paling lama
 * apabila gateway lopyta.com mengalami lag, timeout, atau maintenance sementara.
 */
export declare class LopytaMailQueue {
    private readonly client;
    private readonly storage;
    private readonly maxAgeMs;
    private readonly maxAttempts;
    private readonly backoffScheduleMs;
    private readonly batchProcessLimit;
    private readonly pollIntervalMs;
    private readonly onSent?;
    private readonly onRetry?;
    private readonly onFailed?;
    private timer;
    private activeFlush;
    constructor(client: LopytaMailClient, options?: LopytaMailQueueOptions);
    /**
     * Memasukkan pengiriman 1 email ke antrean dan memicu pengiriman latar secara non-blocking.
     */
    enqueueSend(payload: SendEmailInput, opts?: {
        id?: string;
        delayMs?: number;
        processNow?: boolean;
    }): Promise<QueueJob>;
    /**
     * Memasukkan pengiriman broadcast batch ke antrean agar tetap ter-retry hingga 24 jam bila gateway down.
     */
    enqueueBroadcast(payload: BroadcastEmailInput, opts?: {
        id?: string;
        delayMs?: number;
        processNow?: boolean;
    }): Promise<QueueJob>;
    private enqueueInternal;
    /** Memulai worker polling otomatis di server Node.js/Express. */
    start(): void;
    /** Menghentikan timer polling latar. */
    stop(): void;
    /**
     * Memproses pekerjaan yang jatuh tempo (urutan FIFO dari terlama ke terbaru).
     * Dapat dipanggil langsung oleh endpoint Cron Next.js / Serverless setiap menit.
     */
    processDueJobs(nowMs?: number): Promise<{
        sent: number;
        retried: number;
        failed: number;
    }>;
    private runFlush;
    stats(nowMs?: number): Promise<QueueStats>;
    listFailed(limit?: number): Promise<QueueJob[]>;
    retryFailedJob(jobId?: string): Promise<number>;
}
