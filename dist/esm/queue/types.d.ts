import type { BroadcastEmailInput, BroadcastEmailResponse, SendEmailInput, SendEmailResponse } from "../types.js";
export type QueueJobKind = "send" | "broadcast";
export type QueueJobStatus = "pending" | "processing" | "failed";
export interface QueueJob {
    id: string;
    kind: QueueJobKind;
    payload: SendEmailInput | BroadcastEmailInput;
    status: QueueJobStatus;
    attempts: number;
    createdAt: number;
    updatedAt: number;
    nextAttemptAt: number;
    lastError?: string;
}
export interface QueueStats {
    pending: number;
    processing: number;
    failed: number;
    dueNow: number;
}
export interface QueueStorage {
    enqueue(job: QueueJob): Promise<void>;
    /**
     * Mengambil pekerjaan yang sudah jatuh tempo (status = pending && nextAttemptAt <= nowMs)
     * terurut FIFO dari createdAt paling lama -> terbaru, sekaligus menandai sebagai 'processing'.
     */
    claimDue(nowMs: number, limit: number): Promise<QueueJob[]>;
    markCompleted(jobId: string): Promise<void>;
    reschedule(jobId: string, nextAttemptAt: number, attempts: number, lastError: string): Promise<void>;
    markFailed(jobId: string, attempts: number, lastError: string): Promise<void>;
    listFailed(limit?: number): Promise<QueueJob[]>;
    retryFailed(jobId?: string): Promise<number>;
    getStats(nowMs?: number): Promise<QueueStats>;
}
export interface LopytaMailQueueOptions {
    /** Storage adapter: default MemoryQueueStorage (gunakan FileQueueStorage / RedisQueueStorage di produksi). */
    storage?: QueueStorage;
    /** Batas maksimum usia antrean retry dalam ms (default: 24 jam). */
    maxAgeMs?: number;
    /** Batas maksimum percobaan per item (default: 35). */
    maxAttempts?: number;
    /** Jadwal jeda backoff dalam ms; elemen terakhir diulang hingga maxAgeMs / maxAttempts. */
    backoffScheduleMs?: number[];
    /** Jumlah maksimal job yang diproses per siklus flush (default: 20). */
    batchProcessLimit?: number;
    /** Interval polling pekerja latar dalam ms saat start() dipanggil (default: 5000). */
    pollIntervalMs?: number;
    onSent?: (job: QueueJob, response: SendEmailResponse | BroadcastEmailResponse) => void | Promise<void>;
    onRetry?: (job: QueueJob, err: Error, delayMs: number) => void | Promise<void>;
    onFailed?: (job: QueueJob, err: Error) => void | Promise<void>;
}
