import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  LopytaClientError,
  LopytaMailClient,
  LopytaTransientError,
} from "../dist/esm/index.js";

const require = createRequire(import.meta.url);
const cjsPkg = require("../dist/cjs/index.js");

test("LopytaMailClient CJS & ESM exports work identically and send proper headers", async () => {
  assert.equal(typeof cjsPkg.LopytaMailClient, "function");
  assert.equal(typeof cjsPkg.LopytaMailQueue, "function");

  const captured = [];
  const client = new LopytaMailClient({
    baseUrl: "https://lopyta.com/",
    clientId: "cli_abc",
    clientSecret: "sec_xyz",
    fetchFn: async (url, init) => {
      captured.push({ url, init });
      return new Response(
        JSON.stringify({
          success: true,
          message_id: "msg-123",
          status: "queued",
          from_email: "no-reply@prodistik.lopyta.com",
          from_name: "PRODISTIK ITS",
          to_email: "user@example.com",
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const res = await client.send({
    to: { email: "user@example.com", name: "User" },
    subject: "Halo",
    html: "<p>Isi email</p>",
  });

  assert.equal(res.status, "queued");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://lopyta.com/api/v1/send");
  assert.equal(captured[0].init.headers["X-Client-Id"], "cli_abc");
  assert.equal(captured[0].init.headers["X-Client-Secret"], "sec_xyz");
});

test("LopytaMailClient retries transient 503 quickly and throws LopytaTransientError vs LopytaClientError on 401", async () => {
  let attempts = 0;
  const recoveringClient = new LopytaMailClient({
    baseUrl: "https://lopyta.com",
    clientId: "cli_abc",
    clientSecret: "sec_xyz",
    inlineRetry: { maxAttempts: 2, initialDelayMs: 50, maxDelayMs: 100 },
    fetchFn: async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: "Temporary Maintenance" } }), { status: 503 });
      }
      return new Response(
        JSON.stringify({
          success: true,
          message_id: "msg-ok",
          status: "queued",
          from_email: "no-reply@lopyta.com",
          from_name: "Lopyta",
          to_email: "user@example.com",
        }),
        { status: 202 },
      );
    },
  });

  const ok = await recoveringClient.send({ to: "user@example.com", subject: "Subj", text: "Hi" });
  assert.equal(ok.message_id, "msg-ok");
  assert.equal(attempts, 2);

  const downClient = new LopytaMailClient({
    baseUrl: "https://lopyta.com",
    clientId: "cli_abc",
    clientSecret: "sec_xyz",
    inlineRetry: { maxAttempts: 2, initialDelayMs: 50, maxDelayMs: 100 },
    fetchFn: async () => new Response("Bad Gateway", { status: 502 }),
  });

  await assert.rejects(
    () => downClient.send({ to: "user@example.com", subject: "Subj", text: "Hi" }),
    (err) => err instanceof LopytaTransientError && err.retryable === true && err.statusCode === 502,
  );

  let authAttempts = 0;
  const badAuthClient = new LopytaMailClient({
    baseUrl: "https://lopyta.com",
    clientId: "cli_abc",
    clientSecret: "wrong",
    inlineRetry: { maxAttempts: 3, initialDelayMs: 50, maxDelayMs: 100 },
    fetchFn: async () => {
      authAttempts++;
      return new Response(JSON.stringify({ error: { code: "unauthorized", message: "Invalid secret" } }), {
        status: 401,
      });
    },
  });

  await assert.rejects(
    () => badAuthClient.send({ to: "user@example.com", subject: "Subj", text: "Hi" }),
    (err) => err instanceof LopytaClientError && err.retryable === false && err.statusCode === 401,
  );
  assert.equal(authAttempts, 1, "Permanent 401 must NOT retry");
});

test("LopytaMailClient chunks large broadcasts > 25000 automatically", async () => {
  const sentBatches = [];
  const client = new LopytaMailClient({
    baseUrl: "https://lopyta.com",
    clientId: "cli_abc",
    clientSecret: "sec_xyz",
    fetchFn: async (_url, init) => {
      const parsed = JSON.parse(String(init.body));
      sentBatches.push(parsed);
      return new Response(
        JSON.stringify({
          success: true,
          batch_id: `batch-${sentBatches.length}`,
          external_batch_id: parsed.external_batch_id,
          status: "queued",
          from_email: "no-reply@lopyta.com",
          from_name: "Lopyta",
          accepted_count: parsed.recipients.length,
          skipped_invalid_count: 0,
          rate_limit_per_sec: 50,
        }),
        { status: 202 },
      );
    },
  });

  const recipients = Array.from({ length: 5 }, (_, i) => ({ email: `u${i}@example.com` }));
  const chunks = await client.broadcastChunked(
    { subject: "Bulk", html: "<p>Hi</p>", external_batch_id: "ev-1", recipients },
    2,
  );
  assert.equal(chunks.length, 3);
  assert.equal(sentBatches[0].external_batch_id, "ev-1-part-1");
  assert.equal(sentBatches[2].recipients.length, 1);
});
