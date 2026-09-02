import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { batchDeleteByDate } from "./batchDelete.ts";

/** Minimal in-memory stand-in for the PostgREST query builder. */
function makeFakeSupabase(opts: {
  eligible: number;
  serverCap?: number;      // server-side row cap applied to SELECT
  selectError?: string;
  deleteError?: string;
  deleteNothing?: boolean; // simulate RLS silently blocking deletes
}) {
  let remaining = opts.eligible;
  const serverCap = opts.serverCap ?? 1000;
  let selects = 0;
  let deletes = 0;

  const api = {
    from() {
      return {
        select() {
          selects++;
          let limit = serverCap;
          const q: any = {
            lt: () => q,
            order: () => q,
            eq: () => q,
            limit: (n: number) => { limit = Math.min(n, serverCap); return q; },
            then: (resolve: (v: any) => void) => {
              if (opts.selectError) return resolve({ data: null, error: { message: opts.selectError } });
              const n = Math.min(limit, remaining);
              const rows = Array.from({ length: n }, (_, i) => ({ id: `id-${remaining - i}` }));
              return resolve({ data: rows, error: null });
            },
          };
          return q;
        },
        delete() {
          const q: any = {
            in: (_col: string, ids: string[]) => {
              deletes++;
              if (opts.deleteError) return Promise.resolve({ error: { message: opts.deleteError }, count: null });
              if (opts.deleteNothing) return Promise.resolve({ error: null, count: 0 });
              const removed = Math.min(ids.length, remaining);
              remaining -= removed;
              return Promise.resolve({ error: null, count: removed });
            },
          };
          return q;
        },
      };
    },
    stats: () => ({ selects, deletes, remaining }),
  };
  return api;
}

const CUTOFF = "2026-01-01T00:00:00.000Z";

Deno.test("deletes everything eligible across many batches (no premature exit)", async () => {
  const db = makeFakeSupabase({ eligible: 4321 });
  const res = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now());
  assertEquals(res.deleted, 4321);
  assertEquals(res.batches, 9); // 8 full 500-row batches + remainder
  assertEquals(res.truncated, false);
  assertEquals(db.stats().remaining, 0);
});

Deno.test("regression: a short batch does not stop the loop", async () => {
  // Server caps SELECT at 300 while BATCH_SIZE asks for 500, so every read is
  // "short". The old `rows.length < BATCH_SIZE` exit would have quit after one.
  const db = makeFakeSupabase({ eligible: 1200, serverCap: 300 });
  const res = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now());
  assertEquals(res.deleted, 1200);
  assertEquals(res.batches, 4);
});

Deno.test("no eligible rows is a clean no-op", async () => {
  const db = makeFakeSupabase({ eligible: 0 });
  const res = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now());
  assertEquals(res, { deleted: 0, batches: 0, truncated: false });
  assertEquals(db.stats().deletes, 0);
});

Deno.test("second run over already-clean data deletes nothing (idempotent)", async () => {
  const db = makeFakeSupabase({ eligible: 900 });
  const first = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now());
  const second = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now());
  assertEquals(first.deleted, 900);
  assertEquals(second.deleted, 0);
  assertEquals(second.batches, 0);
});

Deno.test("batch cap bounds work per invocation and flags more work", async () => {
  const db = makeFakeSupabase({ eligible: 100000 });
  const res = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now(), undefined, {
    maxBatches: 3,
  });
  assertEquals(res.batches, 3);
  assertEquals(res.deleted, 1500);
  assertEquals(res.truncated, true);
});

Deno.test("runtime budget stops the loop and flags more work", async () => {
  const db = makeFakeSupabase({ eligible: 100000 });
  let clock = 0;
  const res = await batchDeleteByDate(db, "notifications", CUTOFF, "test", 0, undefined, {
    maxRuntimeMs: 1000,
    now: () => (clock += 600), // exceeds budget on the third check
  });
  assertEquals(res.truncated, true);
  assertEquals(res.deleted, 1000);
});

Deno.test("a delete that removes nothing stops instead of looping forever", async () => {
  const db = makeFakeSupabase({ eligible: 5000, deleteNothing: true });
  const res = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now());
  assertEquals(res.deleted, 0);
  assertEquals(res.batches, 1);
  assertEquals(res.truncated, true);
});

Deno.test("select error aborts with partial progress reported", async () => {
  const db = makeFakeSupabase({ eligible: 5000, selectError: "boom-select" });
  const res = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now());
  assertEquals(res.error, "boom-select");
  assertEquals(res.truncated, true);
  assertEquals(res.deleted, 0);
});

Deno.test("delete error aborts with partial progress reported", async () => {
  const db = makeFakeSupabase({ eligible: 5000, deleteError: "boom-delete" });
  const res = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now());
  assertEquals(res.error, "boom-delete");
  assertEquals(res.truncated, true);
});

Deno.test("extra filters are applied to the select (is_read scoping)", async () => {
  let eqCalls = 0;
  const db = makeFakeSupabase({ eligible: 10 });
  const res = await batchDeleteByDate(db, "notifications", CUTOFF, "test", Date.now(), (q) => {
    eqCalls++;
    return q.eq("is_read", true);
  });
  assertEquals(res.deleted, 10);
  assertEquals(eqCalls, 1);
});
