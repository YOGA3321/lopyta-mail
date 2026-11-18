import type { QueueJob, QueueStats, QueueStorage } from "./types.js";
/**
 * Storage antrean persisten berbasis file JSON dengan write-rename atomik.
 * Zero dependency eksternal: antrean tetap tersimpan di disk meskipun aplikasi Node.js restart,
 * lalu melanjutkan retry pengiriman ke Lopyta Gateway hingga maksimal 24 jam (FIFO).
 */
export declare class FileQueueStorage implements QueueStorage {
    private readonly filePath;
    private lockChain;
    private recoveredStale;
    constructor(options: {
        filePath: string;
    });
    private withLock;
    private readJobs;
    private writeJobs;
    enqueue(job: QueueJob): Promise<void>;
    claimDue(nowMs: number, limit: number): Promise<QueueJob[]>;
    markCompleted(jobId: string): Promise<void>;
    reschedule(jobId: string, nextAttemptAt: number, attempts: number, lastError: string): Promise<void>;
    markFailed(jobId: string, attempts: number, lastError: string): Promise<void>;
    listFailed(limit?: number): Promise<QueueJob[]>;
    retryFailed(jobId?: string): Promise<number>;
    getStats(nowMs?: number): Promise<QueueStats>;
}
