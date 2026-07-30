import { describe, it, expect, vi } from "vitest";
import { performEventDeletion, resolveSeriesRootId } from "./eventSeriesDeletion";

function makeSupabase(results: Array<{ error: { message: string } | null }>) {
  const calls: Array<{ column: string; value: string }> = [];
  let i = 0;
  const supabase = {
    from: () => ({
      delete: () => ({
        eq: (column: string, value: string) => {
          calls.push({ column, value });
          return Promise.resolve(results[i++] ?? { error: null });
        },
      }),
    }),
  } as any;
  return { supabase, calls };
}

describe("resolveSeriesRootId", () => {
  it("uses the event id for a recurring root", () => {
    expect(resolveSeriesRootId({ id: "root", is_recurring: true })).toBe("root");
  });
  it("uses parent_event_id for a recurring child", () => {
    expect(resolveSeriesRootId({ id: "child", parent_event_id: "root" })).toBe("root");
  });
});

describe("performEventDeletion", () => {
  it("deletes a single event exactly once", async () => {
    const { supabase, calls } = makeSupabase([{ error: null }]);
    const out = await performEventDeletion(supabase, { id: "e1" }, "single");
    expect(out).toEqual({ kind: "success" });
    expect(calls).toEqual([{ column: "id", value: "e1" }]);
  });

  it("reports failure for a denied single delete", async () => {
    const { supabase } = makeSupabase([{ error: { message: "permission denied" } }]);
    const out = await performEventDeletion(supabase, { id: "e1" }, "single");
    expect(out).toEqual({ kind: "failed", message: "permission denied" });
  });

  it("stops before the root delete when the child delete is denied", async () => {
    const { supabase, calls } = makeSupabase([{ error: { message: "denied" } }]);
    const out = await performEventDeletion(
      supabase,
      { id: "root", is_recurring: true },
      "series",
    );
    expect(out.kind).toBe("failed");
    expect(calls).toEqual([{ column: "parent_event_id", value: "root" }]);
  });

  it("reports a partial series when children commit but the root fails", async () => {
    const { supabase, calls } = makeSupabase([
      { error: null },
      { error: { message: "root denied" } },
    ]);
    const out = await performEventDeletion(
      supabase,
      { id: "child", parent_event_id: "root" },
      "series",
    );
    expect(out.kind).toBe("partial-series");
    expect(calls).toEqual([
      { column: "parent_event_id", value: "root" },
      { column: "id", value: "root" },
    ]);
  });

  it("reports complete success only when both writes commit", async () => {
    const { supabase } = makeSupabase([{ error: null }, { error: null }]);
    const out = await performEventDeletion(
      supabase,
      { id: "root", is_recurring: true },
      "series",
    );
    expect(out).toEqual({ kind: "success" });
  });
});
