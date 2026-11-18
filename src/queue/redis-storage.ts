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
export class RedisQueueStorage implements QueueStorage {
  private readonly redis: RedisLike;
  private readonly key: string;
  private lockChain: Promise<void> = Promise.resolve();

  constructor(options: { redis: RedisLike; keyPrefix?: string }) {
    this.redis = options.redis;
    const prefix = (options.keyPrefix ?? "lopyta:mail_queue").replace(/:+$/, "");
    this.key = `${prefix}:jobs`;
  }

  private async withLocalLock<T>(fn: () => Promise<T>): Promise<T> {
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
    const raw = await this.redis.get(this.key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueJob[]) : [];
  }

  private async writeJobs(jobs: QueueJob[]): Promise<void> {
    await this.redis.set(this.key, JSON.stringify(jobs));
  }

  async enqueue(job: QueueJob): Promise<void> {
    return this.withLocalLock(async () => {
      const jobs = await this.readJobs();
      jobs.push({ ...job });
      await this.writeJobs(jobs);
    });
  }

  async claimDue(nowMs: number, limit: number): Promise<QueueJob[]> {
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
    return this.withLocalLock(async () => {
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
    return this.withLocalLock(async () => {
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
    return this.withLocalLock(async () => {
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
    const jobs = await this.readJobs();
    return jobs
      .filter((j) => j.status === "failed")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  async retryFailed(jobId?: string): Promise<number> {
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

  async getStats(nowMs = Date.now()): Promise<QueueStats> {
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
  }
}
