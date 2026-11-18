import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FileQueueStorage,
  LopytaMailClient,
  LopytaMailQueue,
  MemoryQueueStorage,
  RedisQueueStorage,
} from "../dist/esm/index.js";

test("LopytaMailQueue processes FIFO oldest-first, retries transient outages up to 24h, and recovers on FileQueueStorage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lopyta-queue-test-"));
  const filePath = join(dir, "queue.json");
  let gatewayDown = true;
  const deliveredOrder = [];

  const client = new LopytaMailClient({
    baseUrl: "https://lopyta.com",
    clientId: "cli_q",
    clientSecret: "sec_q",
    inlineRetry: { maxAttempts: 1 },
    fetchFn: async (_url, init) => {
      if (gatewayDown) {
        return new Response("Gateway Maintenance", { status: 503 });
      }
      const payload = JSON.parse(String(init.body));
      deliveredOrder.push(payload.subject);
      return new Response(
        JSON.stringify({
          success: true,
          message_id: `id-${deliveredOrder.length}`,
          status: "queued",
          from_email: "no-reply@lopyta.com",
          from_name: "Lopyta",
          to_email: "a@b.com",
        }),
        { status: 202 },
      );
    },
  });

  try {
    const q1 = new LopytaMailQueue(client, {
      storage: new FileQueueStorage({ filePath }),
      backoffScheduleMs: [10_000, 30_000],
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    const job1 = await q1.enqueueSend({ to: "1@b.com", subject: "Pertama", text: "1" }, { processNow: false });
    await new Promise((r) => setTimeout(r, 10));
    await q1.enqueueSend({ to: "2@b.com", subject: "Kedua", text: "2" }, { processNow: false });

    // First flush while gateway is down -> both rescheduled
    const failPass = await q1.processDueJobs(job1.createdAt + 20);
    assert.equal(failPass.retried, 2);
    assert.equal(failPass.sent, 0);

    // Gateway comes back online AND app restarts with a fresh FileQueueStorage instance!
    gatewayDown = false;
    const qRestarted = new LopytaMailQueue(client, {
      storage: new FileQueueStorage({ filePath }),
    });

    // Advance simulated clock past 10s backoff
    const recoveryPass = await qRestarted.processDueJobs(job1.createdAt + 15_000);
    assert.equal(recoveryPass.sent, 2);
    assert.deepEqual(deliveredOrder, ["Pertama", "Kedua"]);

    const stats = await qRestarted.stats();
    assert.equal(stats.pending, 0);
    assert.equal(stats.failed, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LopytaMailQueue expires jobs after 24h maxAgeMs and immediately fails permanent 401", async () => {
  const failedEvents = [];
  const client = new LopytaMailClient({
    baseUrl: "https://lopyta.com",
    clientId: "cli_q",
    clientSecret: "sec_q",
    inlineRetry: { maxAttempts: 1 },
    fetchFn: async (_url, init) => {
      const payload = JSON.parse(String(init.body));
      if (payload.subject === "Invalid Auth") {
        return new Response(JSON.stringify({ error: { message: "Invalid secret" } }), { status: 401 });
      }
      return new Response("Offline", { status: 503 });
    },
  });

  const queue = new LopytaMailQueue(client, {
    storage: new MemoryQueueStorage(),
    maxAgeMs: 24 * 60 * 60 * 1000,
    onFailed: (job) => {
      failedEvents.push(job.payload.subject);
    },
  });

  const jobPerm = await queue.enqueueSend({ to: "a@b.com", subject: "Invalid Auth", text: "x" }, { processNow: false });
  const pass1 = await queue.processDueJobs(jobPerm.createdAt);
  assert.equal(pass1.failed, 1);

  const jobExpired = await queue.enqueueSend({ to: "a@b.com", subject: "Outage >24h", text: "y" }, { processNow: false });
  // Simulate 24 hours + 1 second later
  const pass24h = await queue.processDueJobs(jobExpired.createdAt + 24 * 60 * 60 * 1000 + 1000);
  assert.equal(pass24h.failed, 1);
  assert.deepEqual(failedEvents, ["Invalid Auth", "Outage >24h"]);
});

test("RedisQueueStorage works with duck-typed Redis client", async () => {
  const store = new Map();
  const fakeRedis = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, val) {
      store.set(key, val);
      return "OK";
    },
  };

  const client = new LopytaMailClient({
    baseUrl: "https://lopyta.com",
    clientId: "cli_r",
    clientSecret: "sec_r",
    fetchFn: async () => new Response(JSON.stringify({ success: true, batch_id: "b1", status: "queued" }), { status: 202 }),
  });

  const queue = new LopytaMailQueue(client, {
    storage: new RedisQueueStorage({ redis: fakeRedis, keyPrefix: "test:mail" }),
  });

  await queue.enqueueBroadcast(
    {
      subject: "News",
      html: "<p>Hi</p>",
      recipients: [{ email: "user@example.com" }],
    },
    { processNow: false },
  );

  const res = await queue.processDueJobs();
  assert.equal(res.sent, 1);
  assert.equal((await queue.stats()).pending, 0);
});
