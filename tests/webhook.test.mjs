import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createExpressWebhookMiddleware,
  createNextWebhookHandler,
  parseWebhookEvent,
  verifyWebhookSignature,
} from "../dist/esm/index.js";

const SECRET = "whsec_unit_test_secret";

function sign(raw) {
  return `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`;
}

test("verifyWebhookSignature & parseWebhookEvent accept valid HMAC and reject tampering", () => {
  const raw = JSON.stringify({
    delivery_id: "del-1",
    event: "email.delivered",
    client_id: "cli_abc",
    timestamp: "2026-11-18T00:00:00Z",
    data: {
      gateway_message_id: "msg-1",
      recipient_email: "user@example.com",
      status: "delivered",
    },
  });

  assert.equal(verifyWebhookSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyWebhookSignature(raw, "sha256=deadbeef", SECRET), false);

  const parsed = parseWebhookEvent(raw, sign(raw), SECRET);
  assert.equal(parsed.event, "email.delivered");
  assert.equal(parsed.data.recipient_email, "user@example.com");
});

test("Next.js App Router webhook handler & Express middleware dispatch typed callbacks", async () => {
  const raw = JSON.stringify({
    delivery_id: "del-2",
    event: "batch.completed",
    client_id: "cli_abc",
    timestamp: "2026-11-18T00:00:00Z",
    data: {
      batch_id: "b-1",
      total_recipients: 10,
      sent_count: 10,
      failed_count: 0,
      status: "completed",
    },
  });

  let nextBatchId = null;
  const postHandler = createNextWebhookHandler({
    webhookSecret: SECRET,
    onBatchCompleted: async (data) => {
      nextBatchId = data.batch_id;
    },
  });

  const badRes = await postHandler(
    new Request("https://app.test/api/webhooks/email", {
      method: "POST",
      headers: { "X-Gateway-Signature": "sha256=wrong", "Content-Type": "application/json" },
      body: raw,
    }),
  );
  assert.equal(badRes.status, 403);

  const okRes = await postHandler(
    new Request("https://app.test/api/webhooks/email", {
      method: "POST",
      headers: { "X-Gateway-Signature": sign(raw), "Content-Type": "application/json" },
      body: raw,
    }),
  );
  assert.equal(okRes.status, 200);
  assert.equal(nextBatchId, "b-1");

  let expressEvent = null;
  const expressMw = createExpressWebhookMiddleware({
    webhookSecret: SECRET,
    onEvent: (env) => {
      expressEvent = env.event;
    },
  });

  let expressStatus = 0;
  let expressJson = null;
  await expressMw(
    {
      body: Buffer.from(raw, "utf8"),
      headers: { "x-gateway-signature": sign(raw) },
    },
    {
      status(code) {
        expressStatus = code;
        return this;
      },
      json(payload) {
        expressJson = payload;
      },
    },
  );
  assert.equal(expressStatus, 200);
  assert.equal(expressEvent, "batch.completed");
  assert.equal(expressJson.status, "processed");
});
