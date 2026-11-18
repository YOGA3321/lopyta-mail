import type { QueueJob, QueueStats, QueueStorage } from "./types.js";
/**
 * Storage in-memory FIFO sederhana (cocok untuk skrip/test atau proses non-persisten).
 * Untuk ketahanan antar restart VPS, gunakan FileQueueStorage atau RedisQueueStorage.
 */
export declare class MemoryQueueStorage implements QueueStorage {
    private readonly jobs;
    enqueue(job: QueueJob): Promise<void>;
    claimDue(nowMs: number, limit: number): Promise<QueueJob[]>;
    markCompleted(jobId: string): Promise<void>;
    reschedule(jobId: string, nextAttemptAt: number, attempts: number, lastError: string): Promise<void>;
    markFailed(jobId: string, attempts: number, lastError: string): Promise<void>;
    listFailed(limit?: number): Promise<QueueJob[]>;
    retryFailed(jobId?: string): Promise<number>;
    getStats(nowMs?: number): Promise<QueueStats>;
}
