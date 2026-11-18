"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileQueueStorage = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
/**
 * Storage antrean persisten berbasis file JSON dengan write-rename atomik.
 * Zero dependency eksternal: antrean tetap tersimpan di disk meskipun aplikasi Node.js restart,
 * lalu melanjutkan retry pengiriman ke Lopyta Gateway hingga maksimal 24 jam (FIFO).
 */
class FileQueueStorage {
    filePath;
    lockChain = Promise.resolve();
    recoveredStale = false;
    constructor(options) {
        if (!options.filePath?.trim()) {
            throw new Error("FileQueueStorage memerlukan filePath.");
        }
        this.filePath = options.filePath;
    }
    async withLock(fn) {
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
        try {
            const raw = await (0, promises_1.readFile)(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
            if (!this.recoveredStale) {
                this.recoveredStale = true;
                for (const j of jobs) {
                    if (j.status === "processing") {
                        j.status = "pending";
                    }
                }
            }
            return jobs;
        }
        catch (err) {
            if (err?.code === "ENOENT") {
                this.recoveredStale = true;
                return [];
            }
            throw err;
        }
    }
    async writeJobs(jobs) {
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(this.filePath), { recursive: true });
        const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        await (0, promises_1.writeFile)(tmpPath, JSON.stringify({ jobs }, null, 2), "utf8");
        await (0, promises_1.rename)(tmpPath, this.filePath);
    }
    async enqueue(job) {
        return this.withLock(async () => {
            const jobs = await this.readJobs();
            jobs.push({ ...job });
            await this.writeJobs(jobs);
        });
    }
    async claimDue(nowMs, limit) {
        return this.withLock(async () => {
            const jobs = await this.readJobs();
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
        return this.withLock(async () => {
            const jobs = await this.readJobs();
            const next = jobs.filter((j) => j.id !== jobId);
            if (next.length !== jobs.length) {
                await this.writeJobs(next);
            }
        });
    }
    async reschedule(jobId, nextAttemptAt, attempts, lastError) {
        return this.withLock(async () => {
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
        return this.withLock(async () => {
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
        return this.withLock(async () => {
            const jobs = await this.readJobs();
            return jobs
                .filter((j) => j.status === "failed")
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, limit);
        });
    }
    async retryFailed(jobId) {
        return this.withLock(async () => {
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
        return this.withLock(async () => {
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
        });
    }
}
exports.FileQueueStorage = FileQueueStorage;
