/**
 * Security + reliability regression tests for the Stripe webhook.
 *
 * Covers the confirmed defects:
 *  1. Stripe cannot reach the webhook (verify_jwt must be false).
 *  2. Future-dated / malformed / stale signatures were accepted.
 *  3. Webhook retries were not idempotent (durable event ledger + atomic claim).
 *
 * The real handler imports `Deno.serve` + esm.sh modules and cannot run under
 * Vitest, so the signature module is tested directly and the handler's claim /
 * complete / fail control flow is reproduced faithfully in a harness.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  verifyStripeSignature,
  signStripePayload,
  parseStripeTimestamp,
  parseStripeSignatureHeader,
  timingSafeEqual,
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
} from "../../supabase/functions/_shared/stripeSignature.ts";

const SECRET = "whsec_test_secret_value";
const NOW = 1_800_000_000;
const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const webhookSource = read("supabase/functions/stripe-webhook/index.ts");
const configToml = read("supabase/config.toml");
const migrations = read(
  "supabase/migrations/" +
    require("node:fs")
      .readdirSync(path.join(root, "supabase/migrations"))
      .filter((f: string) => f.endsWith(".sql"))
      .sort()
      .reverse()
      .find((f: string) =>
        readFileSync(path.join(root, "supabase/migrations", f), "utf8").includes(
          "stripe_webhook_events",
        ),
      )!,
);

// ---------------------------------------------------------------------------
// 1. Gateway configuration
// ---------------------------------------------------------------------------
describe("stripe-webhook gateway configuration", () => {
  it("is configured with verify_jwt = false so Stripe can reach it", () => {
    const block = configToml.match(
      /\[functions\.stripe-webhook\]\s*\n\s*verify_jwt\s*=\s*(\w+)/,
    );
    expect(block).not.toBeNull();
    expect(block![1]).toBe("false");
  });

  it("still treats the handler as untrusted: signature verification is mandatory", () => {
    expect(webhookSource).toMatch(/verifyStripeSignature\(/);
    expect(webhookSource).toMatch(/status: 401/);
  });
});

// ---------------------------------------------------------------------------
// 2. Signature verification
// ---------------------------------------------------------------------------
describe("stripe signature verification", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "invoice.paid" });

  it("fails closed when the webhook secret is missing", async () => {
    const res = await verifyStripeSignature(payload, "t=1,v1=aa", undefined, NOW);
    expect(res).toEqual({ valid: false, reason: "missing_secret" });
  });

  it("rejects a missing signature header", async () => {
    const res = await verifyStripeSignature(payload, null, SECRET, NOW);
    expect(res).toEqual({ valid: false, reason: "missing_signature" });
  });

  it("accepts a valid current signature", async () => {
    const header = await signStripePayload(payload, SECRET, NOW);
    expect(await verifyStripeSignature(payload, header, SECRET, NOW)).toEqual({
      valid: true,
    });
  });

  it("rejects an invalid signature for the same timestamp", async () => {
    const header = `t=${NOW},v1=${"ab".repeat(32)}`;
    const res = await verifyStripeSignature(payload, header, SECRET, NOW);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("signature_mismatch");
  });

  it("verifies the exact raw body — a re-serialised body does not match", async () => {
    const header = await signStripePayload(payload, SECRET, NOW);
    const reserialised = JSON.stringify(JSON.parse(payload), null, 2);
    expect((await verifyStripeSignature(reserialised, header, SECRET, NOW)).valid).toBe(
      false,
    );
  });

  it("rejects signatures older than 300 seconds", async () => {
    const header = await signStripePayload(payload, SECRET, NOW - 301);
    expect(await verifyStripeSignature(payload, header, SECRET, NOW)).toEqual({
      valid: false,
      reason: "timestamp_out_of_tolerance",
    });
  });

  it("rejects signatures more than 300 seconds in the future", async () => {
    const header = await signStripePayload(payload, SECRET, NOW + 301);
    expect(await verifyStripeSignature(payload, header, SECRET, NOW)).toEqual({
      valid: false,
      reason: "timestamp_out_of_tolerance",
    });
  });

  it("accepts signatures exactly at the tolerance boundary in both directions", async () => {
    for (const skew of [-STRIPE_SIGNATURE_TOLERANCE_SECONDS, STRIPE_SIGNATURE_TOLERANCE_SECONDS]) {
      const header = await signStripePayload(payload, SECRET, NOW + skew);
      expect((await verifyStripeSignature(payload, header, SECRET, NOW)).valid).toBe(true);
    }
  });

  it.each(["t=,v1=aa", "t=abc,v1=aa", "t=12abc,v1=aa", "t=1.5,v1=aa", "t=NaN,v1=aa", "t=Infinity,v1=aa", "v1=aa"])(
    "rejects malformed timestamp header %s",
    async (header) => {
      const res = await verifyStripeSignature(payload, header, SECRET, NOW);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("malformed_timestamp");
    },
  );

  it("rejects a header with no v1 signature", async () => {
    const res = await verifyStripeSignature(payload, `t=${NOW}`, SECRET, NOW);
    expect(res).toEqual({ valid: false, reason: "malformed_signature" });
  });

  it("accepts a header containing multiple v1 signatures when one is valid", async () => {
    const valid = await signStripePayload(payload, SECRET, NOW);
    const hex = valid.split("v1=")[1];
    const header = `t=${NOW},v1=${"cd".repeat(32)},v1=${hex},v0=ignored`;
    expect((await verifyStripeSignature(payload, header, SECRET, NOW)).valid).toBe(true);
  });

  it("rejects when every v1 candidate is wrong", async () => {
    const header = `t=${NOW},v1=${"cd".repeat(32)},v1=${"ef".repeat(32)}`;
    expect((await verifyStripeSignature(payload, header, SECRET, NOW)).valid).toBe(false);
  });

  it("parses timestamps strictly and compares bytes in constant time", () => {
    expect(parseStripeTimestamp("100")).toBe(100);
    expect(parseStripeTimestamp("1e3")).toBeNull();
    expect(parseStripeSignatureHeader("t=5,v1=a,v1=b").v1).toEqual(["a", "b"]);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it("never returns the secret, signature or payload in a failure reason", async () => {
    const header = `t=${NOW},v1=${"ab".repeat(32)}`;
    const res = await verifyStripeSignature(payload, header, SECRET, NOW);
    const serialised = JSON.stringify(res);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain("ab".repeat(32));
    expect(serialised).not.toContain("invoice.paid");
  });
});

// ---------------------------------------------------------------------------
// 3. Idempotency ledger harness (mirrors the handler's control flow)
// ---------------------------------------------------------------------------
type LedgerStatus = "processing" | "completed" | "failed";
interface LedgerRow {
  status: LedgerStatus;
  attempts: number;
  updatedAt: number;
}

class FakeLedgerDb {
  ledger = new Map<string, LedgerRow>();
  storage = new Map<string, number>();
  payments: any[] = [];
  notifications: any[] = [];
  now = 0;
  staleAfterMs = 15 * 60 * 1000;
  failNextBusinessMutation = false;

  claim(eventId: string): string {
    const existing = this.ledger.get(eventId);
    if (!existing) {
      this.ledger.set(eventId, { status: "processing", attempts: 1, updatedAt: this.now });
      return "claimed";
    }
    if (existing.status === "completed") return "duplicate_completed";
    if (existing.status === "processing" && existing.updatedAt > this.now - this.staleAfterMs) {
      return "in_progress";
    }
    existing.status = "processing";
    existing.attempts += 1;
    existing.updatedAt = this.now;
    return "claimed";
  }

  complete(eventId: string) {
    const row = this.ledger.get(eventId);
    if (row) {
      row.status = "completed";
      row.updatedAt = this.now;
    }
  }

  fail(eventId: string, error: string) {
    const row = this.ledger.get(eventId);
    if (row) {
      row.status = "failed";
      row.updatedAt = this.now;
      (row as any).lastError = error.slice(0, 300);
    }
  }

  /** Mirrors apply_stripe_storage_addon: increment + notify + complete atomically. */
  applyStorageAddon(eventId: string, clubId: string, gb: number, userId: string) {
    const row = this.ledger.get(eventId);
    if (!row) throw new Error("stripe event not claimed");
    if (row.status === "completed") return "already_applied";

    const snapshotStorage = new Map(this.storage);
    const snapshotNotifications = [...this.notifications];
    try {
      this.storage.set(clubId, (this.storage.get(clubId) ?? 0) + gb);
      this.notifications.push({ userId, type: "storage_purchased", clubId, gb });
      if (this.failNextBusinessMutation) {
        this.failNextBusinessMutation = false;
        throw new Error("db failure mid-transaction");
      }
      row.status = "completed";
      row.updatedAt = this.now;
      return "applied";
    } catch (e) {
      // Transactional rollback.
      this.storage = snapshotStorage;
      this.notifications = snapshotNotifications;
      throw e;
    }
  }
}

/** Faithful reproduction of the handler's claim → mutate → complete/fail flow. */
async function processEvent(db: FakeLedgerDb, event: any) {
  const eventId: string | null = typeof event?.id === "string" ? event.id : null;
  let claimed = false;
  let selfCompleted = false;

  if (eventId) {
    const result = db.claim(eventId);
    if (result === "duplicate_completed") return { status: 200, duplicate: true };
    if (result === "in_progress") return { status: 409 };
    claimed = true;
  }

  try {
    const meta = event?.data?.object?.metadata ?? {};
    if (event.type === "checkout.session.completed" && meta.type === "storage_addon") {
      db.applyStorageAddon(eventId!, meta.club_id, Number(meta.storage_gb), meta.user_id);
      selfCompleted = true;
    } else if (event.type === "checkout.session.completed" && meta.type === "event_payment") {
      const exists = db.payments.some(
        (p) => p.eventId === meta.event_id && p.userId === meta.user_id,
      );
      if (!exists) {
        db.payments.push({ eventId: meta.event_id, userId: meta.user_id });
        db.notifications.push({ userId: meta.user_id, type: "payment_confirmed" });
      }
    } else if (event.type === "some.unknown.event") {
      // Unknown events: acknowledged with no mutations.
    } else if (event.type === "boom") {
      throw new Error("retriable processing failure");
    }

    if (claimed && !selfCompleted) db.complete(eventId!);
    return { status: 200 };
  } catch (e: any) {
    if (claimed) db.fail(eventId!, e.message);
    return { status: 500 };
  }
}

describe("stripe webhook idempotency ledger", () => {
  const storageEvent = (id: string) => ({
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        metadata: { type: "storage_addon", club_id: "club-1", storage_gb: "50", user_id: "u1" },
      },
    },
  });

  it("duplicate delivery of the same event id does not repeat mutations", async () => {
    const db = new FakeLedgerDb();
    const first = await processEvent(db, storageEvent("evt_1"));
    const second = await processEvent(db, storageEvent("evt_1"));
    expect(first.status).toBe(200);
    expect(second).toEqual({ status: 200, duplicate: true });
    expect(db.storage.get("club-1")).toBe(50);
    expect(db.notifications).toHaveLength(1);
  });

  it("storage add-ons increment exactly once across many retries", async () => {
    const db = new FakeLedgerDb();
    for (let i = 0; i < 5; i++) await processEvent(db, storageEvent("evt_storage"));
    expect(db.storage.get("club-1")).toBe(50);
  });

  it("concurrent duplicate deliveries permit only one processor", async () => {
    const db = new FakeLedgerDb();
    expect(db.claim("evt_c")).toBe("claimed");
    expect(db.claim("evt_c")).toBe("in_progress");
    expect(db.claim("evt_c")).toBe("in_progress");
  });

  it("a failed attempt can be retried safely and then completes", async () => {
    const db = new FakeLedgerDb();
    db.failNextBusinessMutation = true;
    const failed = await processEvent(db, storageEvent("evt_retry"));
    expect(failed.status).toBe(500);
    expect(db.ledger.get("evt_retry")!.status).toBe("failed");
    // Partial database failure must not leave a completed ledger record.
    expect(db.storage.get("club-1")).toBeUndefined();
    expect(db.notifications).toHaveLength(0);

    const retried = await processEvent(db, storageEvent("evt_retry"));
    expect(retried.status).toBe(200);
    expect(db.ledger.get("evt_retry")!.status).toBe("completed");
    expect(db.ledger.get("evt_retry")!.attempts).toBe(2);
    expect(db.storage.get("club-1")).toBe(50);
  });

  it("a stale processing claim is reclaimable so events never get stuck", () => {
    const db = new FakeLedgerDb();
    expect(db.claim("evt_stale")).toBe("claimed");
    db.now += 16 * 60 * 1000;
    expect(db.claim("evt_stale")).toBe("claimed");
  });

  it("event payments and their notifications are recorded exactly once", async () => {
    const db = new FakeLedgerDb();
    const ev = {
      id: "evt_pay",
      type: "checkout.session.completed",
      data: { object: { metadata: { type: "event_payment", event_id: "e1", user_id: "u1" } } },
    };
    await processEvent(db, ev);
    await processEvent(db, ev);
    expect(db.payments).toHaveLength(1);
    expect(db.notifications.filter((n) => n.type === "payment_confirmed")).toHaveLength(1);
  });

  it("unknown event types are acknowledged with no mutations", async () => {
    const db = new FakeLedgerDb();
    const res = await processEvent(db, { id: "evt_unknown", type: "some.unknown.event" });
    expect(res.status).toBe(200);
    expect(db.storage.size).toBe(0);
    expect(db.notifications).toHaveLength(0);
  });

  it("retriable processing failures return non-2xx so Stripe retries", async () => {
    const db = new FakeLedgerDb();
    const res = await processEvent(db, { id: "evt_boom", type: "boom" });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 4. Out-of-order safety + ledger lockdown (asserted against the migration SQL)
// ---------------------------------------------------------------------------
describe("stripe webhook ledger schema and out-of-order safety", () => {
  it("creates a ledger with a database-enforced unique event id and status set", () => {
    expect(migrations).toMatch(/stripe_event_id text PRIMARY KEY/);
    expect(migrations).toMatch(/status IN \('processing', 'completed', 'failed'\)/);
    expect(migrations).toMatch(/attempts integer NOT NULL DEFAULT 0/);
    expect(migrations).toMatch(/completed_at timestamptz/);
    expect(migrations).toMatch(/last_error text/);
    expect(migrations).toMatch(/stripe_object_id text/);
  });

  it("keeps the ledger and its RPCs inaccessible to anon and authenticated", () => {
    expect(migrations).toMatch(
      /REVOKE ALL ON public\.stripe_webhook_events FROM authenticated/,
    );
    expect(migrations).toMatch(/REVOKE ALL ON public\.stripe_webhook_events FROM anon/);
    expect(migrations).toMatch(/ALTER TABLE public\.stripe_webhook_events ENABLE ROW LEVEL SECURITY/);
    for (const fn of [
      "claim_stripe_webhook_event",
      "complete_stripe_webhook_event",
      "fail_stripe_webhook_event",
      "apply_stripe_storage_addon",
    ]) {
      expect(migrations).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`),
      );
      expect(migrations).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`),
      );
    }
  });

  it("sets a safe search_path on every SECURITY DEFINER function", () => {
    const definerBlocks = migrations.split("SECURITY DEFINER").slice(1);
    expect(definerBlocks.length).toBeGreaterThan(0);
    for (const block of definerBlocks) {
      expect(block.slice(0, 200)).toMatch(/SET search_path = public, pg_temp/);
    }
  });

  it("records the last applied Stripe event so older events cannot overwrite newer state", () => {
    expect(migrations).toMatch(/last_stripe_event_id text/);
    expect(migrations).toMatch(/last_stripe_event_at timestamptz/);
    expect(webhookSource).toMatch(/isStaleStripeEvent/);
    expect(webhookSource).toMatch(/Skipping out-of-order cancellation/);
    expect(webhookSource).toMatch(/Skipping out-of-order renewal/);
    expect(webhookSource).toMatch(/Skipping out-of-order subscription update/);
  });

  it("does not store webhook secrets or full Stripe payloads in the ledger", () => {
    expect(migrations).not.toMatch(/whsec_/);
    expect(migrations).not.toMatch(/payload jsonb|raw_body|event_payload/);
  });
});
