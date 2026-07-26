/**
 * GENUINE queue + worker tests.
 *
 * Replaces the previous placeholder file (which only re-tested notification
 * row shapes). These exercise the actual worker code paths in
 * `process-push-delivery-queue/delivery.ts` against a queue simulation whose
 * rules mirror `claim_push_delivery_jobs()` (the same rules are asserted
 * against real Postgres in supabase/tests/push_delivery_queue_test.sql).
 */
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { QueueSim, STALE_MS } from "./queueSim.ts";
import { buildDedupeKey, changeVersion } from "./dedupe.ts";
import {
  BATCH,
  backoffSeconds,
  buildUpdate,
  classify,
  type Deps,
  MAX_ATTEMPTS,
  processBatch,
} from "../process-push-delivery-queue/delivery.ts";

const payload = {
  title: "Ignite",
  body: "You've been invited to: Carnival",
  url: "/events/e1",
  tag: "event_invite-n1",
  notificationType: "event_invite",
};

function seed(sim: QueueSim, n: number) {
  for (let i = 0; i < n; i++) sim.enqueue(`n${i}`, `u${i}`, { ...payload, tag: `event_invite-n${i}` });
}

function deps(sim: QueueSim, send: Deps["sendPush"]): Deps {
  return {
    timeoutMs: 50,
    now: () => sim.now,
    sendPush: send,
    updateJob: (id, patch) => Promise.resolve(sim.update(id, patch)),
  };
}

const okSend: Deps["sendPush"] = () => Promise.resolve({ ok: true, status: 200, body: { sent: 1 } });

// ---------------------------------------------------------------- draining

Deno.test("multiple worker invocations drain 200 jobs, nothing dropped or duplicated", async () => {
  const sim = new QueueSim();
  seed(sim, 200);
  const sentTo: string[] = [];
  const d = deps(sim, (job) => {
    sentTo.push(job.notification_id);
    return Promise.resolve({ ok: true, status: 200, body: { sent: 1 } });
  });

  let invocations = 0;
  while (true) {
    const jobs = sim.claim(BATCH);
    if (jobs.length === 0) break;
    invocations++;
    await processBatch(jobs, d);
  }

  assertEquals(sim.count("delivered"), 200);
  assertEquals(sim.count("pending"), 0);
  assertEquals(sim.count("processing"), 0);
  assertEquals(sentTo.length, 200);
  assertEquals(new Set(sentTo).size, 200);
  assertEquals(invocations, Math.ceil(200 / BATCH));
});

Deno.test("termination after the first batch leaves the rest recoverable; a later cron run drains them", async () => {
  const sim = new QueueSim();
  seed(sim, 200);
  const d = deps(sim, okSend);

  // First invocation only — then the function is killed.
  await processBatch(sim.claim(BATCH), d);
  assertEquals(sim.count("delivered"), BATCH);
  assertEquals(sim.count("pending"), 200 - BATCH);

  // Cron picks up the remainder.
  let guard = 0;
  while (guard++ < 50) {
    const jobs = sim.claim(BATCH);
    if (!jobs.length) break;
    await processBatch(jobs, d);
  }
  assertEquals(sim.count("delivered"), 200);
});

Deno.test("one failed recipient does not block later recipients", async () => {
  const sim = new QueueSim();
  seed(sim, 10);
  const d = deps(sim, (job) =>
    job.notification_id === "n3"
      ? Promise.reject(new Error("socket hang up"))
      : Promise.resolve({ ok: true, status: 200, body: { sent: 1 } })
  );
  const c = await processBatch(sim.claim(BATCH), d);
  assertEquals(c.delivered, 9);
  assertEquals(c.retried, 1);
  assertEquals(sim.count("delivered"), 9);
  assertEquals(sim.count("pending"), 1);
});

// ---------------------------------------------------- retry / terminal rules

Deno.test("network timeout retries with backoff", async () => {
  const sim = new QueueSim();
  seed(sim, 1);
  const d = deps(sim, () => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5)));
  const c = await processBatch(sim.claim(BATCH), d);
  assertEquals(c.retried, 1);
  const row = sim.rows[0];
  assertEquals(row.status, "pending");
  assertEquals(row.attempt_count, 1);
  assert(row.next_attempt_at > sim.now, "next_attempt_at must be in the future");
});

Deno.test("HTTP 429 and 5xx retry; 400/404/410 are terminal", async () => {
  for (const status of [429, 500, 503]) {
    assertEquals(classify({ ok: false, status, body: null }).classification, "retry", `status ${status}`);
  }
  for (const status of [400, 404, 410]) {
    assertEquals(classify({ ok: false, status, body: null }).classification, "permanent", `status ${status}`);
  }
});

Deno.test("permanent failure marks failed immediately without exhausting attempts", async () => {
  const sim = new QueueSim();
  seed(sim, 1);
  const d = deps(sim, () => Promise.resolve({ ok: false, status: 410, body: { error: "gone" } }));
  const c = await processBatch(sim.claim(BATCH), d);
  assertEquals(c.failed, 1);
  assertEquals(sim.rows[0].status, "failed");
  assertEquals(sim.rows[0].attempt_count, 1);
});

Deno.test("retryable failures reach a terminal failed state after MAX_ATTEMPTS", async () => {
  const sim = new QueueSim();
  seed(sim, 1);
  const d = deps(sim, () => Promise.resolve({ ok: false, status: 500, body: null }));
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    sim.now += backoffSeconds(i + 1) * 1000 + 1000;
    const jobs = sim.claim(BATCH);
    assertEquals(jobs.length, 1, `attempt ${i + 1} should be claimable`);
    await processBatch(jobs, d);
  }
  assertEquals(sim.rows[0].status, "failed");
  assertEquals(sim.rows[0].attempt_count, MAX_ATTEMPTS);
  // Terminal jobs are never reclaimed.
  sim.now += STALE_MS * 10;
  assertEquals(sim.claim(BATCH).length, 0);
});

Deno.test("backoff is capped exponential", () => {
  assertEquals(backoffSeconds(1), 30);
  assertEquals(backoffSeconds(2), 120);
  assertEquals(backoffSeconds(3), 480);
  assertEquals(backoffSeconds(4), 1920);
  assertEquals(backoffSeconds(9), 7200);
});

// ---------------------------------------------- delivered / skipped accuracy

Deno.test("preference-disabled response becomes skipped, not delivered", async () => {
  const sim = new QueueSim();
  seed(sim, 1);
  const d = deps(sim, () =>
    Promise.resolve({
      ok: true,
      status: 200,
      body: { message: "Notification skipped - user preference", sent: 0 },
    })
  );
  const c = await processBatch(sim.claim(BATCH), d);
  assertEquals(c.skipped, 1);
  assertEquals(sim.rows[0].status, "skipped");
});

Deno.test("HTTP 200 alone is not proof of delivery", () => {
  assertEquals(classify({ ok: true, status: 200, body: { sent: 0 } }).classification, "skipped");
  assertEquals(classify({ ok: true, status: 200, body: { skipped: true } }).classification, "skipped");
  assertEquals(classify({ ok: true, status: 200, body: { sent: 2 } }).classification, "delivered");
  const unverified = classify({ ok: true, status: 200, body: null });
  assertEquals(unverified.classification, "delivered");
  assertEquals(unverified.note, "unverified_response_body");
});

Deno.test("a successfully delivered job is never left in processing", async () => {
  const sim = new QueueSim();
  seed(sim, 5);
  await processBatch(sim.claim(BATCH), deps(sim, okSend));
  assertEquals(sim.count("processing"), 0);
});

Deno.test("queue status-update failure is detected and left recoverable", async () => {
  const sim = new QueueSim();
  seed(sim, 1);
  const d: Deps = {
    ...deps(sim, okSend),
    updateJob: () => Promise.resolve({ updated: 0, error: { code: "57014" } }),
  };
  const c = await processBatch(sim.claim(BATCH), d);
  assertEquals(c.status_update_failures, 1);
  assertEquals(c.delivered, 0);
  // Row stays processing → reclaimed after the stale window (at-least-once).
  assertEquals(sim.rows[0].status, "processing");
  sim.now += STALE_MS + 1000;
  assertEquals(sim.claim(BATCH).length, 1);
});

Deno.test("recovery cannot convert an already-delivered job to skipped", async () => {
  const sim = new QueueSim();
  seed(sim, 1);
  const job = sim.claim(BATCH)[0];
  // Worker A delivers.
  assertEquals(sim.update(job.id, buildUpdate("delivered", 1, undefined, sim.now)).updated, 1);
  // Worker B (duplicate) tries to mark it skipped.
  const second = sim.update(job.id, buildUpdate("skipped", 1, "sent=0", sim.now));
  assertEquals(second.updated, 0);
  assertEquals(sim.rows[0].status, "delivered");
});

Deno.test("concurrent workers cannot claim the same job twice", () => {
  const sim = new QueueSim();
  seed(sim, 40);
  const a = sim.claim(30);
  const b = sim.claim(30);
  assertEquals(a.length, 30);
  assertEquals(b.length, 10);
  const ids = [...a, ...b].map((j) => j.id);
  assertEquals(new Set(ids).size, 40);
});

Deno.test("future next_attempt_at jobs are not claimed early", () => {
  const sim = new QueueSim();
  seed(sim, 1);
  sim.rows[0].next_attempt_at = sim.now + 60_000;
  assertEquals(sim.claim(BATCH).length, 0);
  sim.now += 61_000;
  assertEquals(sim.claim(BATCH).length, 1);
});

Deno.test("stale processing jobs are reclaimed, fresh ones are not", () => {
  const sim = new QueueSim();
  seed(sim, 1);
  assertEquals(sim.claim(BATCH).length, 1);
  sim.now += STALE_MS - 1000;
  assertEquals(sim.claim(BATCH).length, 0, "not stale yet");
  sim.now += 2000;
  assertEquals(sim.claim(BATCH).length, 1, "reclaimed once stale");
});

Deno.test("no service-role key or vault secret appears in recorded errors", async () => {
  const sim = new QueueSim();
  seed(sim, 1);
  const d = deps(sim, () =>
    Promise.resolve({ ok: false, status: 500, body: { error: "upstream" } })
  );
  await processBatch(sim.claim(BATCH), d);
  const err = sim.rows[0].last_error ?? "";
  assert(!/eyJ|sb_secret_|Bearer /.test(err), `leaked credential in ${err}`);
});

// ------------------------------------------------------------- idempotency

Deno.test("queue enqueue is idempotent per notification", () => {
  const sim = new QueueSim();
  assertEquals(sim.enqueue("n1", "u1", payload), true);
  assertEquals(sim.enqueue("n1", "u1", payload), false);
  assertEquals(sim.rows.length, 1);
});

Deno.test("invite dedupe key is one per event/user; updates are versioned", async () => {
  assertEquals(
    buildDedupeKey({ notificationType: "event_invite", eventId: "e1", userId: "u1" }),
    "event_invite:e1:u1",
  );
  assertEquals(
    buildDedupeKey({ notificationType: "event_cancelled", eventId: "e1", userId: "u1" }),
    "event_cancelled:e1:u1",
  );

  const v1 = await changeVersion([{ field: "start_time", old: "09:00", new: "10:00" }]);
  const v1Again = await changeVersion([{ field: "start_time", old: "09:00", new: "10:00" }]);
  const v2 = await changeVersion([{ field: "start_time", old: "10:00", new: "11:00" }]);
  assertEquals(v1, v1Again, "same update retried → same key (deduplicated)");
  assert(v1 !== v2, "different legitimate update → different key (deliverable)");

  const k1 = buildDedupeKey({ notificationType: "event_updated", eventId: "e1", userId: "u1", version: v1 });
  const k2 = buildDedupeKey({ notificationType: "event_updated", eventId: "e1", userId: "u1", version: v2 });
  assert(k1 !== k2);
});

Deno.test("changed-field order does not change the update version", async () => {
  const a = await changeVersion([
    { field: "location", old: "A", new: "B" },
    { field: "title", old: "X", new: "Y" },
  ]);
  const b = await changeVersion([
    { field: "title", old: "X", new: "Y" },
    { field: "location", old: "A", new: "B" },
  ]);
  assertEquals(a, b);
});
