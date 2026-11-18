"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisQueueStorage = void 0;
/**
 * Storage antrean terpusat menggunakan Redis (cocok untuk Next.js serverless/multi-instance).
 */
class RedisQueueStorage {
    redis;
    key;
    lockChain = Promise.resolve();
    constructor(options) {
        this.redis = options.redis;
        const prefix = (options.keyPrefix ?? "lopyta:mail_queue").replace(/:+$/, "");
        this.key = `${prefix}:jobs`;
    }
    async withLocalLock(fn) {
        let release;
        const prev = this.lockChain;
        this.lockChain = new Promise((res) => {
            release = res;
        });
        await prev;
        try {
            return await fn();
        }
        finally {
            release();
        }
    }
    async readJobs() {
        const raw = await this.redis.get(this.key);
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    async writeJobs(jobs) {
        await this.redis.set(this.key, JSON.stringify(jobs));
    }
    async enqueue(job) {
        return this.withLocalLock(async () => {
            const jobs = await this.readJobs();
            jobs.push({ ...job });
            await this.writeJobs(jobs);
        });
    }
    async claimDue(nowMs, limit) {
        return this.withLocalLock(async () => {
            const jobs = await this.readJobs();
            const staleProcessingMs = 5 * 60 * 1000;
            for (const j of jobs) {
                if (j.status === "processing" && nowMs - j.updatedAt > staleProcessingMs) {
                    j.status = "pending";
                }
            }
            const due = jobs
                .filter((j) => j.status === "pending" && j.nextAttemptAt <= nowMs)
                .sort((a, b) => a.createdAt - b.createdAt || a.nextAttemptAt - b.nextAttemptAt)
                .slice(0, Math.max(1, limit));
            if (due.length === 0)
                return [];
            const claimedIds = new Set(due.map((j) => j.id));
            for (const j of jobs) {
                if (claimedIds.has(j.id)) {
                    j.status = "processing";
                    j.updatedAt = nowMs;
                }
            }
            await this.writeJobs(jobs);
            return due.map((j) => ({ ...j }));
        });
    }
    async markCompleted(jobId) {
        return this.withLocalLock(async () => {
            const jobs = await this.readJobs();
            const next = jobs.filter((j) => j.id !== jobId);
            if (next.length !== jobs.length) {
                await this.writeJobs(next);
            }
        });
    }
    async reschedule(jobId, nextAttemptAt, attempts, lastError) {
        return this.withLocalLock(async () => {
            const jobs = await this.readJobs();
            const target = jobs.find((j) => j.id === jobId);
            if (!target)
                return;
            target.status = "pending";
            target.attempts = attempts;
            target.nextAttemptAt = nextAttemptAt;
            target.lastError = lastError;
            target.updatedAt = Date.now();
            await this.writeJobs(jobs);
        });
    }
    async markFailed(jobId, attempts, lastError) {
        return this.withLocalLock(async () => {
            const jobs = await this.readJobs();
            const target = jobs.find((j) => j.id === jobId);
            if (!target)
                return;
            target.status = "failed";
            target.attempts = attempts;
            target.lastError = lastError;
            target.updatedAt = Date.now();
            await this.writeJobs(jobs);
        });
    }
    async listFailed(limit = 100) {
        const jobs = await this.readJobs();
        return jobs
            .filter((j) => j.status === "failed")
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, limit);
    }
    async retryFailed(jobId) {
        return this.withLocalLock(async () => {
            const jobs = await this.readJobs();
            const now = Date.now();
            let count = 0;
            for (const j of jobs) {
                if (j.status === "failed" && (!jobId || j.id === jobId)) {
                    j.status = "pending";
                    j.nextAttemptAt = now;
                    j.updatedAt = now;
                    count++;
                }
            }
            if (count > 0) {
                await this.writeJobs(jobs);
            }
            return count;
        });
    }
    async getStats(nowMs = Date.now()) {
        const jobs = await this.readJobs();
        let pending = 0;
        let processing = 0;
        let failed = 0;
        let dueNow = 0;
        for (const j of jobs) {
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
exports.RedisQueueStorage = RedisQueueStorage;
