/**
 * Storage in-memory FIFO sederhana (cocok untuk skrip/test atau proses non-persisten).
 * Untuk ketahanan antar restart VPS, gunakan FileQueueStorage atau RedisQueueStorage.
 */
export class MemoryQueueStorage {
    jobs = new Map();
    async enqueue(job) {
        this.jobs.set(job.id, { ...job });
    }
    async claimDue(nowMs, limit) {
        const due = Array.from(this.jobs.values())
            .filter((j) => j.status === "pending" && j.nextAttemptAt <= nowMs)
            .sort((a, b) => a.createdAt - b.createdAt || a.nextAttemptAt - b.nextAttemptAt)
            .slice(0, Math.max(1, limit));
        for (const job of due) {
            job.status = "processing";
            job.updatedAt = nowMs;
        }
        return due.map((j) => ({ ...j }));
    }
    async markCompleted(jobId) {
        this.jobs.delete(jobId);
    }
    async reschedule(jobId, nextAttemptAt, attempts, lastError) {
        const existing = this.jobs.get(jobId);
        if (!existing)
            return;
        existing.status = "pending";
        existing.attempts = attempts;
        existing.nextAttemptAt = nextAttemptAt;
        existing.lastError = lastError;
        existing.updatedAt = Date.now();
    }
    async markFailed(jobId, attempts, lastError) {
        const existing = this.jobs.get(jobId);
        if (!existing)
            return;
        existing.status = "failed";
        existing.attempts = attempts;
        existing.lastError = lastError;
        existing.updatedAt = Date.now();
    }
    async listFailed(limit = 100) {
        return Array.from(this.jobs.values())
            .filter((j) => j.status === "failed")
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, limit)
            .map((j) => ({ ...j }));
    }
    async retryFailed(jobId) {
        const now = Date.now();
        let count = 0;
        for (const job of this.jobs.values()) {
            if (job.status === "failed" && (!jobId || job.id === jobId)) {
                job.status = "pending";
                job.nextAttemptAt = now;
                job.updatedAt = now;
                count++;
            }
        }
        return count;
    }
    async getStats(nowMs = Date.now()) {
        let pending = 0;
        let processing = 0;
        let failed = 0;
        let dueNow = 0;
        for (const j of this.jobs.values()) {
            if (j.status === "pending") {
                pending++;
                if (j.nextAttemptAt <= nowMs)
                    dueNow++;
            }
            else if (j.status === "processing") {
                processing++;
            }
            else if (j.status === "failed") {
                failed++;
            }
        }
        return { pending, processing, failed, dueNow };
    }
}
