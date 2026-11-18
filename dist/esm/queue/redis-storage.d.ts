import type { QueueJob, QueueStats, QueueStorage } from "./types.js";
/**
 * Antarmuka minimal klien Redis agar kompatibel dengan ioredis, node-redis v4+, maupun Upstash
 * tanpa memaksa instalasi paket Redis di aplikasi yang tidak menggunakannya.
 */
export interface RedisLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
}
/**
 * Storage antrean terpusat menggunakan Redis (cocok untuk Next.js serverless/multi-instance).
 */
export declare class RedisQueueStorage implements QueueStorage {
    private readonly redis;
    private readonly key;
    private lockChain;
    constructor(options: {
        redis: RedisLike;
        keyPrefix?: string;
    });
    private withLocalLock;
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
