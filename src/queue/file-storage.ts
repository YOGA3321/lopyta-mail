import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QueueJob, QueueStats, QueueStorage } from "./types.js";

interface PersistedFileData {
  jobs: QueueJob[];
}

/**
 * Storage antrean persisten berbasis file JSON dengan write-rename atomik.
 * Zero dependency eksternal: antrean tetap tersimpan di disk meskipun aplikasi Node.js restart,
 * lalu melanjutkan retry pengiriman ke Lopyta Gateway hingga maksimal 24 jam (FIFO).
 */
export class FileQueueStorage implements QueueStorage {
  private readonly filePath: string;
  private lockChain: Promise<void> = Promise.resolve();
  private recoveredStale = false;

  constructor(options: { filePath: string }) {
    if (!options.filePath?.trim()) {
      throw new Error("FileQueueStorage memerlukan filePath.");
    }
    this.filePath = options.filePath;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.lockChain;
    this.lockChain = new Promise<void>((res) => {
      release = res;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async readJobs(): Promise<QueueJob[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedFileData;
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
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        this.recoveredStale = true;
        return [];
      }
      throw err;
    }
  }

  private async writeJobs(jobs: QueueJob[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify({ jobs }, null, 2), "utf8");
    await rename(tmpPath, this.filePath);
  }

  async enqueue(job: QueueJob): Promise<void> {
    return this.withLock(async () => {
      const jobs = await this.readJobs();
      jobs.push({ ...job });
      await this.writeJobs(jobs);
    });
  }

  async claimDue(nowMs: number, limit: number): Promise<QueueJob[]> {
    return this.withLock(async () => {
      const jobs = await this.readJobs();
      const due = jobs
        .filter((j) => j.status === "pending" && j.nextAttemptAt <= nowMs)
        .sort((a, b) => a.createdAt - b.createdAt || a.nextAttemptAt - b.nextAttemptAt)
        .slice(0, Math.max(1, limit));

      if (due.length === 0) return [];

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

  async markCompleted(jobId: string): Promise<void> {
    return this.withLock(async () => {
      const jobs = await this.readJobs();
      const next = jobs.filter((j) => j.id !== jobId);
      if (next.length !== jobs.length) {
        await this.writeJobs(next);
      }
    });
  }

  async reschedule(
    jobId: string,
    nextAttemptAt: number,
    attempts: number,
    lastError: string,
  ): Promise<void> {
    return this.withLock(async () => {
      const jobs = await this.readJobs();
      const target = jobs.find((j) => j.id === jobId);
      if (!target) return;
      target.status = "pending";
      target.attempts = attempts;
      target.nextAttemptAt = nextAttemptAt;
      target.lastError = lastError;
      target.updatedAt = Date.now();
      await this.writeJobs(jobs);
    });
  }

  async markFailed(jobId: string, attempts: number, lastError: string): Promise<void> {
    return this.withLock(async () => {
      const jobs = await this.readJobs();
      const target = jobs.find((j) => j.id === jobId);
      if (!target) return;
      target.status = "failed";
      target.attempts = attempts;
      target.lastError = lastError;
      target.updatedAt = Date.now();
      await this.writeJobs(jobs);
    });
  }

  async listFailed(limit = 100): Promise<QueueJob[]> {
    return this.withLock(async () => {
      const jobs = await this.readJobs();
      return jobs
        .filter((j) => j.status === "failed")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
    });
  }

  async retryFailed(jobId?: string): Promise<number> {
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

  async getStats(nowMs = Date.now()): Promise<QueueStats> {
    return this.withLock(async () => {
      const jobs = await this.readJobs();
      let pending = 0;
      let processing = 0;
      let failed = 0;
      let dueNow = 0;
      for (const j of jobs) {
        if (j.status === "pending") {
          pending++;
          if (j.nextAttemptAt <= nowMs) dueNow++;
        } else if (j.status === "processing") {
          processing++;
        } else if (j.status === "failed") {
          failed++;
        }
      }
      return { pending, processing, failed, dueNow };
    });
  }
}
